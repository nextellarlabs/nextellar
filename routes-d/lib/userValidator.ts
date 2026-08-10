/**
 * userValidator.ts
 *
 * Validates individual user rows parsed from a CSV import.
 * Every field is checked; errors are collected per row so callers
 * can report partial failures without aborting the entire batch.
 */

export interface UserImportRow {
  email: string;
  firstName: string;
  lastName: string;
  /** ISO 3166-1 alpha-2, e.g. "US" */
  country: string;
  /** Optional – "admin" | "user" | "partner"; defaults to "user" */
  role?: string;
  /** Optional – any extra columns are passed through */
  [key: string]: string | undefined;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  /** Normalised row – only set when valid === true */
  data?: UserImportRow;
}

// ----- constants ------------------------------------------------------------

const REQUIRED_FIELDS: Array<keyof UserImportRow> = [
  "email",
  "firstname",
  "lastname",
  "country",
] as Array<keyof UserImportRow>;

const VALID_ROLES = new Set(["admin", "user", "partner"]);

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

const ISO2_RE = /^[A-Z]{2}$/;

const MAX_NAME_LENGTH = 100;

// ----- helpers --------------------------------------------------------------

function fieldErrors(
  fields: Record<string, string>,
): ValidationError[] {
  const errs: ValidationError[] = [];

  // --- required presence ---
  for (const field of REQUIRED_FIELDS) {
    const key = String(field);
    if (!fields[key] || fields[key].trim() === "") {
      errs.push({ field: key, message: `${key} is required` });
    }
  }

  // --- email format ---
  const email = (fields["email"] ?? "").trim();
  if (email && !EMAIL_RE.test(email)) {
    errs.push({ field: "email", message: "email is not a valid address" });
  }

  // --- name length ---
  for (const nameField of ["firstname", "lastname"] as const) {
    const val = (fields[nameField] ?? "").trim();
    if (val && val.length > MAX_NAME_LENGTH) {
      errs.push({
        field: nameField,
        message: `${nameField} must not exceed ${MAX_NAME_LENGTH} characters`,
      });
    }
  }

  // --- country format ---
  const country = (fields["country"] ?? "").trim().toUpperCase();
  if (country && !ISO2_RE.test(country)) {
    errs.push({
      field: "country",
      message: "country must be a 2-letter ISO 3166-1 alpha-2 code",
    });
  }

  // --- role (optional) ---
  const role = (fields["role"] ?? "").trim().toLowerCase();
  if (role && !VALID_ROLES.has(role)) {
    errs.push({
      field: "role",
      message: `role must be one of: ${[...VALID_ROLES].join(", ")}`,
    });
  }

  return errs;
}

// ----- public API -----------------------------------------------------------

/**
 * Validate a single row of parsed CSV fields.
 *
 * @param fields  Raw key-value map from the CSV parser (keys already lowercased)
 * @returns       ValidationResult with errors list and normalised data on success
 */
export function validateUserRow(
  fields: Record<string, string>,
): ValidationResult {
  const errs = fieldErrors(fields);

  if (errs.length > 0) {
    return { valid: false, errors: errs };
  }

  const data: UserImportRow = {
    email: fields["email"].trim().toLowerCase(),
    firstName: fields["firstname"].trim(),
    lastName: fields["lastname"].trim(),
    country: fields["country"].trim().toUpperCase(),
    role: fields["role"]
      ? fields["role"].trim().toLowerCase()
      : "user",
  };

  // Pass through any unknown extra columns
  for (const [key, value] of Object.entries(fields)) {
    if (!(key in data) && key !== "firstname" && key !== "lastname") {
      data[key] = value;
    }
  }

  return { valid: true, errors: [], data };
}

/**
 * Validate an array of parsed CSV row fields, returning per-row results.
 */
export function validateUserRows(
  rows: Array<{ index: number; fields: Record<string, string> }>,
): Array<{ index: number } & ValidationResult> {
  return rows.map(({ index, fields }) => ({
    index,
    ...validateUserRow(fields),
  }));
}

/** Required CSV column names (lowercase, as produced by the parser). */
export const REQUIRED_CSV_COLUMNS: readonly string[] = [
  "email",
  "firstname",
  "lastname",
  "country",
];

/**
 * Check that the parsed header row contains all required columns.
 *
 * @returns list of missing column names (empty = OK)
 */
export function checkRequiredColumns(headers: string[]): string[] {
  const headerSet = new Set(headers.map((h) => h.toLowerCase().trim()));
  return REQUIRED_CSV_COLUMNS.filter((col) => !headerSet.has(col));
}
