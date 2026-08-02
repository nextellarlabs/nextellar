/**
 * routes-d/lib/crypto.ts
 *
 * AES-256-GCM field-level encryption / decryption used by the travel rule
 * data exchange endpoint.
 *
 * Key-id scheme
 * ─────────────
 * Every encrypted payload carries a `kid` (key ID) so the receiving party can
 * identify which symmetric key was used without embedding key material in the
 * ciphertext.  Keys are resolved from the environment at call-time via the
 * helper `resolveKey`.
 *
 * Environment variables
 * ─────────────────────
 *   TRAVEL_RULE_KEY_<KID>   Hex-encoded 32-byte (256-bit) key, e.g.:
 *                           TRAVEL_RULE_KEY_v1=<64 hex chars>
 *
 *   TRAVEL_RULE_KEY_ACTIVE  The kid to use when encrypting new payloads.
 *                           Defaults to "v1".
 *
 * Wire format (JSON-serialisable EncryptedField)
 * ───────────────────────────────────────────────
 *   { kid, iv, tag, ciphertext }  – all values are hex strings.
 */

import nodeCrypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit nonce recommended for GCM
const TAG_BYTES = 16;  // 128-bit authentication tag

// ── Types ──────────────────────────────────────────────────────────────────

export interface EncryptedField {
  /** Key identifier that resolves to the symmetric key used for this field. */
  kid: string;
  /** Hex-encoded 12-byte initialisation vector. */
  iv: string;
  /** Hex-encoded 16-byte GCM authentication tag. */
  tag: string;
  /** Hex-encoded ciphertext. */
  ciphertext: string;
}

// ── Key resolution ─────────────────────────────────────────────────────────

/**
 * Reads the raw 32-byte key for a given `kid` from the environment.
 * Throws a descriptive error if the variable is missing or the key length is wrong.
 */
export function resolveKey(kid: string): Buffer {
  const envVar = `TRAVEL_RULE_KEY_${kid.toUpperCase()}`;
  const hex = process.env[envVar];

  if (!hex) {
    throw new Error(
      `Travel rule encryption key not found: ${envVar}. ` +
        `Set the environment variable to a 64-character hex string (256-bit key).`,
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `Travel rule encryption key ${envVar} must be a 64-character hex string.`,
    );
  }

  return Buffer.from(hex, 'hex');
}

/**
 * Returns the `kid` that should be used when encrypting a new field.
 * Falls back to "v1" if the environment variable is not set.
 */
export function activeKeyId(): string {
  return (process.env.TRAVEL_RULE_KEY_ACTIVE ?? 'v1').trim();
}

// ── Core operations ────────────────────────────────────────────────────────

/**
 * Encrypts `plaintext` using AES-256-GCM and returns an `EncryptedField`.
 *
 * @param plaintext - UTF-8 string to encrypt (e.g. full name, account number).
 * @param kid       - Key identifier; defaults to `activeKeyId()`.
 */
export function encryptField(plaintext: string, kid?: string): EncryptedField {
  const resolvedKid = kid ?? activeKeyId();
  const key = resolveKey(resolvedKid);
  const iv = nodeCrypto.randomBytes(IV_BYTES);

  const cipher = nodeCrypto.createCipheriv(ALGORITHM, key, iv);
  const cipherBuf = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    kid: resolvedKid,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: cipherBuf.toString('hex'),
  };
}

/**
 * Decrypts an `EncryptedField` and returns the original UTF-8 plaintext.
 * Throws if authentication fails (tampered ciphertext or wrong key).
 */
export function decryptField(field: EncryptedField): string {
  const key = resolveKey(field.kid);
  const iv = Buffer.from(field.iv, 'hex');
  const tag = Buffer.from(field.tag, 'hex');
  const ciphertext = Buffer.from(field.ciphertext, 'hex');

  if (iv.length !== IV_BYTES) {
    throw new Error(`Invalid IV length: expected ${IV_BYTES} bytes.`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error(`Invalid auth-tag length: expected ${TAG_BYTES} bytes.`);
  }

  const decipher = nodeCrypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Convenience helper: encrypts an object's fields listed in `fieldNames` in-place
 * (mutates and returns the same object with EncryptedField values replacing plain strings).
 *
 * Only processes fields that are non-empty strings; skips nullish values.
 */
export function encryptFields<T extends Record<string, unknown>>(
  record: T,
  fieldNames: (keyof T)[],
  kid?: string,
): T {
  for (const name of fieldNames) {
    const value = record[name];
    if (typeof value === 'string' && value.length > 0) {
      (record as Record<string, unknown>)[name as string] = encryptField(value, kid);
    }
  }
  return record;
}

/**
 * Convenience helper: decrypts EncryptedField values back to plaintext strings
 * for the listed field names (mutates and returns the same object).
 */
export function decryptFields<T extends Record<string, unknown>>(
  record: T,
  fieldNames: (keyof T)[],
): T {
  for (const name of fieldNames) {
    const value = record[name];
    if (isEncryptedField(value)) {
      (record as Record<string, unknown>)[name as string] = decryptField(value);
    }
  }
  return record;
}

/**
 * Type guard: narrows an unknown value to `EncryptedField`.
 */
export function isEncryptedField(value: unknown): value is EncryptedField {
  if (!value || typeof value !== 'object') return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.kid === 'string' &&
    typeof f.iv === 'string' &&
    typeof f.tag === 'string' &&
    typeof f.ciphertext === 'string'
  );
}

// ── Test/reset helpers (for unit tests only) ───────────────────────────────

/**
 * @internal
 * Exposed so unit tests can inject a deterministic key without touching
 * process.env directly.  Do not use in production code.
 */
export function __setTestKey(kid: string, hexKey: string): void {
  process.env[`TRAVEL_RULE_KEY_${kid.toUpperCase()}`] = hexKey;
}
