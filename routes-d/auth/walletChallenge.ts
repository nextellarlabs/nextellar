import { randomId } from '../lib/tokens.js';
import crypto from 'node:crypto';

/**
 * SEP-10-style Stellar wallet challenge flow.
 *
 * Flow:
 *   1. Caller requests a challenge for a public key  → server stores a
 *      time-bound nonce linked to that key and returns the nonce.
 *   2. Caller signs the nonce bytes with their ed25519 private key and
 *      sends the signature back.
 *   3. Server looks up the nonce, checks expiry / reuse, then delegates
 *      signature verification to the injected `SignatureVerifier`.
 *
 * The store is intentionally in-memory. Production deployments replace it
 * with a Redis-backed implementation behind the same interface.
 *
 * Public keys are stored and accepted as hex-encoded raw 32-byte ed25519
 * keys. A thin wrapper in `routes/auth.wallet.ts` translates Stellar G-keys
 * (Strkey) before calling `issueChallenge`.
 */

const CHALLENGE_TTL_MS =
  Number(process.env.NEXTELLAR_CHALLENGE_TTL_MS ?? 60_000);

export interface ChallengeRecord {
  nonce: string;
  /** Hex-encoded raw 32-byte ed25519 public key. */
  publicKey: string;
  issuedAt: number;
  expiresAt: number;
  used: boolean;
}

/** Process-wide nonce store. Cleared in tests via `challengeStore.clear()`. */
export const challengeStore = new Map<string, ChallengeRecord>();

/**
 * Issue a fresh nonce for `publicKey`. Throws if `publicKey` is empty.
 * @param now - injectable clock for testing
 */
export function issueChallenge(publicKey: string, now = Date.now()): string {
  if (!publicKey) throw new Error('publicKey is required');
  const nonce = randomId('chal');
  challengeStore.set(nonce, {
    nonce,
    publicKey,
    issuedAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
    used: false,
  });
  return nonce;
}

/**
 * A function that returns true iff `signature` is a valid ed25519 signature
 * of `message` under `hexPublicKey`.
 */
export type SignatureVerifier = (
  hexPublicKey: string,
  message: Buffer,
  signature: Buffer,
) => boolean;

/**
 * Default verifier: uses Node's native `crypto.verify` with ed25519.
 * The public key is expected as a hex-encoded raw 32-byte ed25519 key;
 * it is wrapped into SubjectPublicKeyInfo DER form before verification.
 */
export const nodeEd25519Verifier: SignatureVerifier = (
  hexPublicKey,
  message,
  signature,
) => {
  try {
    // SubjectPublicKeyInfo DER prefix for ed25519 (OID 1.3.101.112)
    const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
    const spkiDer = Buffer.concat([SPKI_PREFIX, Buffer.from(hexPublicKey, 'hex')]);
    const keyObj = crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
    return crypto.verify(null, message, keyObj, signature);
  } catch {
    return false;
  }
};

export type VerifyResult =
  | { ok: true; publicKey: string }
  | { ok: false; reason: 'unknown_nonce' | 'expired' | 'already_used' | 'bad_signature' };

/**
 * Verify a challenge response.
 *
 * @param nonce      - the nonce that was issued
 * @param signatureHex - hex-encoded 64-byte ed25519 signature of the nonce bytes
 * @param verify     - signature verifier (defaults to nodeEd25519Verifier)
 * @param now        - injectable clock for expiry tests
 */
export function verifyChallenge(
  nonce: string,
  signatureHex: string,
  verify: SignatureVerifier = nodeEd25519Verifier,
  now = Date.now(),
): VerifyResult {
  const record = challengeStore.get(nonce);
  if (!record) return { ok: false, reason: 'unknown_nonce' };
  if (record.used) return { ok: false, reason: 'already_used' };
  if (now > record.expiresAt) {
    record.used = true;
    return { ok: false, reason: 'expired' };
  }

  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(signatureHex, 'hex');
    if (sigBuf.length !== 64) throw new Error('bad length');
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }

  const valid = verify(record.publicKey, Buffer.from(nonce, 'utf8'), sigBuf);
  if (!valid) return { ok: false, reason: 'bad_signature' };

  record.used = true;
  return { ok: true, publicKey: record.publicKey };
}