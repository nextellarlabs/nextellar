import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
} from 'node:crypto';

/**
 * TOTP (RFC 6238) + secret storage helpers used by the routes-d second-
 * factor endpoints (Issue #258).
 *
 * The module provides three things kept narrow on purpose:
 *
 *   1. `generateTotpSecret` / `formatOtpAuthUrl` — issuance side, including
 *      base32 (RFC 4648) encoding because otpauth:// URIs require it.
 *   2. `generateTotp` / `verifyTotp` — the HMAC-SHA1 OTP itself. We allow
 *      a small drift window (default ±1 step) so a code generated right
 *      at a boundary still verifies, but we also record consumed codes so
 *      the same OTP cannot be replayed inside the verification window.
 *   3. `encryptSecret` / `decryptSecret` — AES-256-GCM around the shared
 *      secret so the at-rest representation of an enrolled secret is not
 *      directly usable if the database is exfiltrated. The key is derived
 *      from `NEXTELLAR_TOTP_ENC_KEY` (with a clearly-marked dev fallback so
 *      tests don't need to plumb env vars but a misconfigured prod is
 *      obvious in audit).
 *
 * Storage of enrolled records lives in `TotpSecretStore`, an in-memory
 * default that mirrors how `passwordTokenStore` is set up elsewhere in
 * routes-d — production deployments swap it for a persistent store with
 * the same surface.
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_DEFAULT_DRIFT_STEPS = 1;

const TOTP_ENC_KEY_NAME = 'NEXTELLAR_TOTP_ENC_KEY';
const TOTP_ENC_FALLBACK_PASSPHRASE =
  'nextellar-routes-d-totp-dev-passphrase';
const TOTP_ENC_SALT = Buffer.from('nextellar-routes-d-totp-salt', 'utf8');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/* -------------------------------------------------------------------------- */
/* base32                                                                     */
/* -------------------------------------------------------------------------- */

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/* -------------------------------------------------------------------------- */
/* TOTP                                                                       */
/* -------------------------------------------------------------------------- */

export function generateTotpSecret(byteLength = 20): {
  raw: Buffer;
  base32: string;
} {
  const raw = randomBytes(byteLength);
  return { raw, base32: base32Encode(raw) };
}

function computeHotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // 64-bit counter, big-endian. JS bitwise ops are 32-bit, so split.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
}

export function generateTotp(
  secret: Buffer,
  timestampMs: number = Date.now(),
): string {
  const counter = Math.floor(timestampMs / 1000 / TOTP_PERIOD_SECONDS);
  return computeHotp(secret, counter);
}

export interface VerifyTotpResult {
  ok: boolean;
  /** The counter that matched, useful for replay tracking. */
  counter?: number;
}

/**
 * Verify a presented OTP. Accepts a small drift window so a code captured
 * right at the boundary still validates. Returns the matching counter so
 * the caller can refuse to honour the same counter twice.
 *
 * Uses a constant-time comparison per step so timing does not leak which
 * window position matched.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  options: {
    timestampMs?: number;
    driftSteps?: number;
  } = {},
): VerifyTotpResult {
  const ts = options.timestampMs ?? Date.now();
  const drift = options.driftSteps ?? TOTP_DEFAULT_DRIFT_STEPS;
  const baseCounter = Math.floor(ts / 1000 / TOTP_PERIOD_SECONDS);

  // Normalise the presented code so callers can pass " 123 456 " or similar.
  const normalised = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalised)) return { ok: false };

  let matched: number | undefined;
  for (let delta = -drift; delta <= drift; delta++) {
    const counter = baseCounter + delta;
    if (counter < 0) continue;
    const expected = computeHotp(secret, counter);
    // Constant-time compare on equal-length strings.
    if (constantTimeEq(expected, normalised) && matched === undefined) {
      matched = counter;
    }
  }
  return matched === undefined ? { ok: false } : { ok: true, counter: matched };
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/* -------------------------------------------------------------------------- */
/* otpauth                                                                    */
/* -------------------------------------------------------------------------- */

export function formatOtpAuthUrl(input: {
  secretBase32: string;
  accountName: string;
  issuer?: string;
}): string {
  const issuer = (input.issuer ?? 'Nextellar').trim();
  const label = encodeURIComponent(`${issuer}:${input.accountName}`);
  const params = new URLSearchParams({
    secret: input.secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* -------------------------------------------------------------------------- */
/* at-rest encryption                                                         */
/* -------------------------------------------------------------------------- */

function deriveKey(): Buffer {
  const passphrase =
    process.env[TOTP_ENC_KEY_NAME]?.trim() || TOTP_ENC_FALLBACK_PASSPHRASE;
  return scryptSync(passphrase, TOTP_ENC_SALT, 32);
}

export interface EncryptedSecret {
  iv: string; // base64
  ciphertext: string; // base64
  authTag: string; // base64
}

export function encryptSecret(plaintext: Buffer): EncryptedSecret {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptSecret(payload: EncryptedSecret): Buffer {
  const key = deriveKey();
  const iv = Buffer.from(payload.iv, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/* -------------------------------------------------------------------------- */
/* enrollment store                                                           */
/* -------------------------------------------------------------------------- */

export type EnrollmentState = 'pending' | 'active';

export interface TotpEnrollmentRecord {
  userId: string;
  encrypted: EncryptedSecret;
  state: EnrollmentState;
  /** Counter of the most recently consumed OTP — used to reject replays. */
  lastUsedCounter?: number;
  createdAt: number;
}

export type VerifyConsumeResult =
  | { ok: true }
  | { ok: false; reason: 'unknown' | 'invalid' | 'replay' };

/**
 * In-memory enrolment store. The encrypted secret is stored alongside the
 * `lastUsedCounter` so the same window's code cannot be replayed even
 * within the drift window.
 */
export class TotpSecretStore {
  private readonly byUser = new Map<string, TotpEnrollmentRecord>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Begin enrolment. Overwrites any previous pending or active record. */
  startEnrollment(userId: string): {
    record: TotpEnrollmentRecord;
    secretBase32: string;
  } {
    const { raw, base32 } = generateTotpSecret();
    const record: TotpEnrollmentRecord = {
      userId,
      encrypted: encryptSecret(raw),
      state: 'pending',
      createdAt: this.now(),
    };
    this.byUser.set(userId, record);
    return { record, secretBase32: base32 };
  }

  /**
   * Verify a code and, on success, transition a pending enrolment to
   * active. Returning a typed `reason` lets the route translate to a
   * stable status code without exposing internal state.
   */
  verifyAndConsume(
    userId: string,
    code: string,
    options: { timestampMs?: number } = {},
  ): VerifyConsumeResult {
    const record = this.byUser.get(userId);
    if (!record) return { ok: false, reason: 'unknown' };

    const secret = decryptSecret(record.encrypted);
    const result = verifyTotp(secret, code, options);
    if (!result.ok || result.counter === undefined) {
      return { ok: false, reason: 'invalid' };
    }
    if (
      record.lastUsedCounter !== undefined &&
      result.counter <= record.lastUsedCounter
    ) {
      return { ok: false, reason: 'replay' };
    }
    record.lastUsedCounter = result.counter;
    if (record.state === 'pending') {
      record.state = 'active';
    }
    return { ok: true };
  }

  /** Whether an account currently requires TOTP on login. */
  isActive(userId: string): boolean {
    return this.byUser.get(userId)?.state === 'active';
  }

  /** Disable TOTP for a user. The caller is expected to have re-authed. */
  disable(userId: string): boolean {
    return this.byUser.delete(userId);
  }

  /** Test/debug helper. */
  inspect(userId: string): TotpEnrollmentRecord | undefined {
    return this.byUser.get(userId);
  }

  /** Test helper. */
  clear(): void {
    this.byUser.clear();
  }
}

export const totpSecretStore = new TotpSecretStore();
