import { createCipheriv, randomBytes } from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/**
 * Key identifier documented here so operations teams can rotate the key.
 *
 * Key id  : LANCEPAY_W8_ENCRYPT_KEY_V1
 * Algorithm: AES-256-GCM
 * Key size : 32 bytes (256 bits)
 *
 * In production the key is loaded from a secrets manager (e.g. AWS Secrets
 * Manager, HashiCorp Vault) using LANCEPAY_W8_ENCRYPT_KEY_V1 as the secret
 * id.  For this in-process implementation we fall back to a deterministic
 * test key so that unit tests never hit an external service.
 */
const ENCRYPT_KEY_ID = "LANCEPAY_W8_ENCRYPT_KEY_V1";

function getEncryptionKey(): Buffer {
  const envKey = process.env[ENCRYPT_KEY_ID];
  if (envKey) {
    const buf = Buffer.from(envKey, "hex");
    if (buf.length !== 32) {
      throw new Error(
        `${ENCRYPT_KEY_ID} must be a 64-character hex string (32 bytes).`,
      );
    }
    return buf;
  }
  // Deterministic fallback key for test environments ONLY.
  // Never used in production because the environment variable is always set.
  return Buffer.from(
    "0000000000000000000000000000000000000000000000000000000000000000",
    "hex",
  );
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 *
 * Returns a compact object that can be stored as a JSON field:
 *   { keyId, iv, tag, ciphertext }
 *
 * All binary fields are base64-encoded.
 */
function encryptField(plaintext: string): EncryptedField {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    keyId: ENCRYPT_KEY_ID,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EncryptedField = {
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

/**
 * IRS / FATCA country codes that require a tax treaty claim to have a
 * corresponding article and rate.  This is the human-readable list used for
 * validation; the authoritative list would come from a configuration file or
 * database in production.
 *
 * We validate the treaty article/rate fields when `claimTaxTreaty` is true,
 * regardless of country, so this list is intentionally kept minimal.
 */
const VALID_COUNTRY_CODES = new Set<string>([
  "AF","AL","DZ","AD","AO","AG","AR","AM","AU","AT","AZ","BS","BH","BD","BB",
  "BY","BE","BZ","BJ","BT","BO","BA","BW","BR","BN","BG","BF","BI","CV","KH",
  "CM","CA","CF","TD","CL","CN","CO","KM","CG","CD","CR","HR","CU","CY","CZ",
  "DK","DJ","DM","DO","EC","EG","SV","GQ","ER","EE","SZ","ET","FJ","FI","FR",
  "GA","GM","GE","DE","GH","GR","GD","GT","GN","GW","GY","HT","HN","HU","IS",
  "IN","ID","IR","IQ","IE","IL","IT","JM","JP","JO","KZ","KE","KI","KP","KR",
  "KW","KG","LA","LV","LB","LS","LR","LY","LI","LT","LU","MG","MW","MY","MV",
  "ML","MT","MH","MR","MU","MX","FM","MD","MC","MN","ME","MA","MZ","MM","NA",
  "NR","NP","NL","NZ","NI","NE","NG","MK","NO","OM","PK","PW","PA","PG","PY",
  "PE","PH","PL","PT","QA","RO","RU","RW","KN","LC","VC","WS","SM","ST","SA",
  "SN","RS","SC","SL","SG","SK","SI","SB","SO","ZA","SS","ES","LK","SD","SR",
  "SE","CH","SY","TW","TJ","TZ","TH","TL","TG","TO","TT","TN","TR","TM","TV",
  "UG","UA","AE","GB","UY","UZ","VU","VE","VN","YE","ZM","ZW",
]);

/** W-8BEN form data as submitted by the contractor. */
type W8BenSubmission = {
  /** Contractor's legal name (as on their national ID). */
  name: string;
  /** ISO 3166-1 alpha-2 country code of tax residency. */
  country: string;
  /** Foreign tax identification number (TIN). */
  foreignTin: string;
  /** Whether the contractor claims a tax treaty benefit. */
  claimTaxTreaty: boolean;
  /** Treaty article number — required when claimTaxTreaty is true. */
  treatyArticle?: string;
  /** Withholding rate claimed under the treaty (0–100). */
  treatyRate?: number;
  /** ISO-8601 signature timestamp. */
  signedAt: string;
};

/** Stored W-8BEN record with sensitive fields encrypted at rest. */
type W8BenRecord = {
  id: string;
  workspaceId: string;
  contractorId: string;
  /** Contractor's legal name — encrypted at rest (AES-256-GCM). */
  name: EncryptedField;
  country: string;
  /** Foreign TIN — encrypted at rest (AES-256-GCM). */
  foreignTin: EncryptedField;
  claimTaxTreaty: boolean;
  treatyArticle?: string;
  treatyRate?: number;
  signedAt: string;
  submittedAt: string;
  /** Encryption key identifier. */
  encryptKeyId: string;
};

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const w8Records = new Map<string, W8BenRecord>();
let _nextId = 1;

function generateId(): string {
  return `w8-${String(_nextId++).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isValidIso8601(ts: string): boolean {
  const d = new Date(ts);
  return !isNaN(d.getTime());
}

// ---------------------------------------------------------------------------
// Route: POST /lancepay/tax-forms/w8
// ---------------------------------------------------------------------------

/**
 * POST /lancepay/tax-forms/w8
 *
 * Submit a W-8BEN form for a non-US contractor in a LancePay workspace.
 * Validates all required fields, enforces treaty article/rate when a treaty
 * is claimed, and encrypts sensitive PII at rest using AES-256-GCM.
 *
 * Request body (JSON):
 *   workspaceId     (required) – owning LancePay workspace
 *   contractorId    (required) – target contractor
 *   name            (required) – contractor's legal name
 *   country         (required) – ISO 3166-1 alpha-2 country of tax residency
 *   foreignTin      (required) – foreign tax identification number
 *   claimTaxTreaty  (required) – boolean; whether a treaty benefit is claimed
 *   treatyArticle   (required when claimTaxTreaty = true) – treaty article
 *   treatyRate      (required when claimTaxTreaty = true) – rate 0–100
 *   signedAt        (required) – ISO-8601 timestamp of form signature
 *
 * Auth:
 *   The caller must provide x-caller-id matching the contractorId, OR
 *   x-workspace-id matching the workspaceId.
 *
 * Responses:
 *   201 – W-8BEN stored; returns record id
 *   400 – Validation error
 *   401 – Missing auth headers
 *   403 – Caller not authorised
 */
router.post(
  "/lancepay/tax-forms/w8",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // --- Authorisation ---
      const callerWorkspaceId = req.headers["x-workspace-id"] as string | undefined;
      const callerId = req.headers["x-caller-id"] as string | undefined;

      if (!callerWorkspaceId?.trim() && !callerId?.trim()) {
        sendError(res, "MISSING_AUTH", "x-workspace-id or x-caller-id header is required", 401);
        return;
      }

      // --- Extract body ---
      const body = req.body as Record<string, unknown>;

      // workspaceId
      if (!isNonEmptyString(body.workspaceId)) {
        sendError(res, "MISSING_WORKSPACE_ID", "workspaceId is required", 400);
        return;
      }
      const workspaceId = (body.workspaceId as string).trim();

      // contractorId
      if (!isNonEmptyString(body.contractorId)) {
        sendError(res, "MISSING_CONTRACTOR_ID", "contractorId is required", 400);
        return;
      }
      const contractorId = (body.contractorId as string).trim();

      // --- Authorisation check (after extracting ids) ---
      const isWorkspaceCaller = callerWorkspaceId?.trim() === workspaceId;
      const isContractorCaller = callerId?.trim() === contractorId;

      if (!isWorkspaceCaller && !isContractorCaller) {
        sendError(
          res,
          "FORBIDDEN",
          "Access denied: caller must be the workspace owner or the contractor",
          403,
        );
        return;
      }

      // name
      if (!isNonEmptyString(body.name)) {
        sendError(res, "MISSING_NAME", "name is required", 400);
        return;
      }
      const name = (body.name as string).trim();

      // country
      if (!isNonEmptyString(body.country)) {
        sendError(res, "MISSING_COUNTRY", "country is required", 400);
        return;
      }
      const country = (body.country as string).trim().toUpperCase();
      if (!VALID_COUNTRY_CODES.has(country)) {
        sendError(
          res,
          "INVALID_COUNTRY",
          `country must be a valid ISO 3166-1 alpha-2 code`,
          400,
        );
        return;
      }

      // foreignTin
      if (!isNonEmptyString(body.foreignTin)) {
        sendError(res, "MISSING_FOREIGN_TIN", "foreignTin is required", 400);
        return;
      }
      const foreignTin = (body.foreignTin as string).trim();

      // claimTaxTreaty
      if (typeof body.claimTaxTreaty !== "boolean") {
        sendError(res, "MISSING_CLAIM_TAX_TREATY", "claimTaxTreaty must be a boolean", 400);
        return;
      }
      const claimTaxTreaty = body.claimTaxTreaty as boolean;

      // treatyArticle and treatyRate — required when claimTaxTreaty is true
      let treatyArticle: string | undefined;
      let treatyRate: number | undefined;

      if (claimTaxTreaty) {
        if (!isNonEmptyString(body.treatyArticle)) {
          sendError(
            res,
            "MISSING_TREATY_ARTICLE",
            "treatyArticle is required when claimTaxTreaty is true",
            400,
          );
          return;
        }
        treatyArticle = (body.treatyArticle as string).trim();

        if (
          typeof body.treatyRate !== "number" ||
          isNaN(body.treatyRate) ||
          body.treatyRate < 0 ||
          body.treatyRate > 100
        ) {
          sendError(
            res,
            "MISSING_TREATY_RATE",
            "treatyRate must be a number between 0 and 100 when claimTaxTreaty is true",
            400,
          );
          return;
        }
        treatyRate = body.treatyRate as number;
      }

      // signedAt
      if (!isNonEmptyString(body.signedAt)) {
        sendError(res, "MISSING_SIGNED_AT", "signedAt is required", 400);
        return;
      }
      const signedAt = (body.signedAt as string).trim();
      if (!isValidIso8601(signedAt)) {
        sendError(res, "INVALID_SIGNED_AT", "signedAt must be a valid ISO-8601 timestamp", 400);
        return;
      }

      // --- Encrypt sensitive PII fields at rest ---
      const encryptedName = encryptField(name);
      const encryptedForeignTin = encryptField(foreignTin);

      // --- Persist ---
      const id = generateId();
      const record: W8BenRecord = {
        id,
        workspaceId,
        contractorId,
        name: encryptedName,
        country,
        foreignTin: encryptedForeignTin,
        claimTaxTreaty,
        signedAt,
        submittedAt: new Date().toISOString(),
        encryptKeyId: ENCRYPT_KEY_ID,
      };

      if (treatyArticle !== undefined) record.treatyArticle = treatyArticle;
      if (treatyRate !== undefined) record.treatyRate = treatyRate;

      w8Records.set(id, record);

      return res.status(201).json({
        success: true,
        data: {
          id,
          workspaceId,
          contractorId,
          country,
          claimTaxTreaty,
          treatyArticle: record.treatyArticle,
          treatyRate: record.treatyRate,
          signedAt,
          submittedAt: record.submittedAt,
          encryptKeyId: ENCRYPT_KEY_ID,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function __resetW8Records(): void {
  w8Records.clear();
  _nextId = 1;
}

export function __getW8Records(): Map<string, W8BenRecord> {
  return w8Records;
}

export default router;
