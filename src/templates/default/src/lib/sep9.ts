/**
 * SEP-9: Standard KYC Fields — shared types and helpers for building
 * anchor KYC/AML payloads (SEP-6, SEP-12, SEP-24).
 *
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0009.md
 *
 * This module is the single source of truth for SEP-9 field names in this
 * codebase. Anywhere KYC data is collected for an anchor flow, build the
 * payload with `buildSep9Payload` (or at least type it as `Sep9Fields`)
 * instead of redeclaring field-name string literals.
 *
 * Field values are always strings/binary per SEP-9 (form fields), except
 * `photo_id_front`/`photo_id_back`/`photo_proof_residence`/`photo_id_back`
 * etc., which are binary (`Blob` in the browser). Those are typed as
 * `Blob | undefined` here; callers assemble the actual `multipart/form-data`
 * request outside this helper.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Standard SEP-9 KYC/AML fields. All fields are optional at the type level —
 * SEP-9 itself doesn't mandate a fixed required subset; the anchor's
 * `/info` (SEP-12) response says which fields it actually requires for a
 * given transaction. Use `buildSep9Payload` to omit empty/undefined values
 * rather than sending blank strings.
 *
 * Fields are grouped and ordered to match the SEP-9 spec's own table.
 */
export interface Sep9Fields {
  // Natural person name
  first_name?: string;
  last_name?: string;
  additional_name?: string;

  // Identity
  /** Date of birth, ISO 8601 (`YYYY-MM-DD`). */
  birth_date?: string;
  birth_place?: string;
  birth_country_code?: string;
  /** ISO 3166-1 alpha-3 tax residence country code. */
  tax_id?: string;
  tax_id_name?: string;
  occupation?: string;
  employer_name?: string;
  employer_address?: string;
  language_code?: string;
  /** `male`, `female`, or `other`. */
  sex?: "male" | "female" | "other";

  // Address
  address_country_code?: string;
  state_or_province?: string;
  city?: string;
  postal_code?: string;
  address?: string;

  // Contact
  /** E.164 phone number. */
  mobile_number?: string;
  /** IANA phone metadata format identifying the mobile number's issuing country/carrier. */
  mobile_number_format?: string;
  email_address?: string;

  // Financial account
  bank_account_number?: string;
  bank_account_type?: string;
  bank_number?: string;
  bank_phone_number?: string;
  bank_branch_number?: string;
  external_transfer_memo?: string;

  // Organization (business KYC)
  organization_name?: string;
  organization_VAT_number?: string;
  organization_registration_number?: string;
  organization_registered_address?: string;
  organization_number_of_shareholders?: number;
  organization_shareholder_name?: string;
  organization_photo_incorporation_doc?: Blob;
  organization_photo_proof_address?: Blob;
  organization_address_country_code?: string;
  organization_state_or_province?: string;
  organization_city?: string;
  organization_postal_code?: string;
  organization_director_name?: string;
  organization_website?: string;
  organization_email?: string;
  organization_phone?: string;

  // Financial info
  /** ISO 4217 currency code. */
  proof_of_income?: Blob;
  proof_of_liveness?: Blob;

  // ID document (binary uploads; not sent as JSON string fields)
  /** `passport`, `id_card`, `drivers_license`, etc. */
  id_type?: string;
  id_country_code?: string;
  id_issue_date?: string;
  id_expiration_date?: string;
  id_number?: string;
  photo_id_front?: Blob;
  photo_id_back?: Blob;
  notary_approval_of_photo_id?: Blob;
  ip_address?: string;
  photo_proof_residence?: Blob;

  /** Base64-encoded signed SEP-10 transaction, when refreshing an existing KYC record. */
  sep9_signature?: string;
}

/** Keys in `Sep9Fields` whose value is binary (a file upload), not a string/number. */
export const SEP9_BINARY_FIELDS: readonly (keyof Sep9Fields)[] = [
  "organization_photo_incorporation_doc",
  "organization_photo_proof_address",
  "proof_of_income",
  "proof_of_liveness",
  "photo_id_front",
  "photo_id_back",
  "notary_approval_of_photo_id",
  "photo_proof_residence",
] as const;

const SEP9_EMAIL_FIELDS: readonly (keyof Sep9Fields)[] = [
  "email_address",
  "organization_email",
];

const SEP9_DATE_FIELDS: readonly (keyof Sep9Fields)[] = [
  "birth_date",
  "id_issue_date",
  "id_expiration_date",
];

// ── Validation ─────────────────────────────────────────────────────────────────

export interface Sep9ValidationError {
  field: keyof Sep9Fields;
  message: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates a partial `Sep9Fields` object without mutating it. Returns an
 * empty array when every present field is well-formed.
 *
 * This does not enforce which fields are *required* — that's anchor- and
 * transaction-specific (from the anchor's own SEP-12 field requirements).
 * It only checks that values present are shaped correctly (e.g. a real
 * ISO date, a plausible email), so malformed values aren't sent upstream.
 */
export function validateSep9Fields(fields: Sep9Fields): Sep9ValidationError[] {
  const errors: Sep9ValidationError[] = [];

  for (const field of SEP9_DATE_FIELDS) {
    const value = fields[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || !ISO_DATE_RE.test(value)) {
      errors.push({ field, message: `${field} must be an ISO 8601 date (YYYY-MM-DD)` });
    }
  }

  for (const field of SEP9_EMAIL_FIELDS) {
    const value = fields[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || !EMAIL_RE.test(value)) {
      errors.push({ field, message: `${field} must be a valid email address` });
    }
  }

  if (fields.sex !== undefined && !["male", "female", "other"].includes(fields.sex)) {
    errors.push({ field: "sex", message: "sex must be one of: male, female, other" });
  }

  if (
    fields.organization_number_of_shareholders !== undefined &&
    (!Number.isFinite(fields.organization_number_of_shareholders) ||
      fields.organization_number_of_shareholders < 0)
  ) {
    errors.push({
      field: "organization_number_of_shareholders",
      message: "organization_number_of_shareholders must be a non-negative number",
    });
  }

  return errors;
}

// ── Builder ────────────────────────────────────────────────────────────────────

/**
 * Builds a SEP-9 payload from partial fields: drops `undefined`, `null`, and
 * empty-string values so a caller can pass a form's raw state directly
 * without hand-pruning unset fields. Preserves `0`, `false`, and populated
 * `Blob`s as-is.
 *
 * @throws if any present field fails `validateSep9Fields`.
 */
export function buildSep9Payload(fields: Sep9Fields): Sep9Fields {
  const errors = validateSep9Fields(fields);
  if (errors.length > 0) {
    throw new Error(
      `buildSep9Payload: invalid SEP-9 fields: ${errors
        .map((e) => `${e.field} (${e.message})`)
        .join("; ")}`,
    );
  }

  const result: Sep9Fields = {};
  for (const [key, value] of Object.entries(fields) as [keyof Sep9Fields, unknown][]) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result as any)[key] = value;
  }
  return result;
}

/**
 * Splits a built SEP-9 payload into its string/number fields and its binary
 * (file upload) fields, so a caller can assemble a `multipart/form-data`
 * request (binary fields) alongside a JSON body (everything else) the way
 * SEP-12's `PUT /customer` expects.
 */
export function splitSep9Payload(fields: Sep9Fields): {
  data: Record<string, string | number>;
  files: Partial<Record<keyof Sep9Fields, Blob>>;
} {
  const data: Record<string, string | number> = {};
  const files: Partial<Record<keyof Sep9Fields, Blob>> = {};

  for (const [key, value] of Object.entries(fields) as [keyof Sep9Fields, unknown][]) {
    if (value === undefined || value === null) continue;
    if (SEP9_BINARY_FIELDS.includes(key)) {
      files[key] = value as Blob;
    } else {
      data[key] = value as string | number;
    }
  }

  return { data, files };
}
