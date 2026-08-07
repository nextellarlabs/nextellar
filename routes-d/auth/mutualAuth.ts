/**
 * routes-d/auth/mutualAuth.ts
 *
 * Mutual-authentication middleware for the travel rule data exchange endpoint.
 *
 * Authentication scheme
 * ─────────────────────
 * Each authorised partner exchange is issued:
 *   1. A stable `partnerId` (e.g. "exchange-abc").
 *   2. A shared secret (`TRAVEL_RULE_PARTNER_SECRET_<PARTNERID>`).
 *
 * Request authentication
 * ──────────────────────
 * The caller MUST include two HTTP headers on every request:
 *
 *   X-Partner-Id     : partnerId
 *   X-Partner-Sig    : HMAC-SHA-256( partnerId + ":" + timestamp + ":" + body-sha256,
 *                                    partnerSecret )
 *                      encoded as lowercase hex.
 *   X-Partner-Ts     : Unix timestamp in seconds (string). Requests older than
 *                      PARTNER_SIG_WINDOW_SECONDS (default 300 s) are rejected.
 *
 * The signature binds the partner id, a freshness timestamp, and a SHA-256 hash of
 * the raw request body so the middleware can detect replay and tampering.
 *
 * Partner registry
 * ────────────────
 * Partners are registered via environment variables:
 *
 *   TRAVEL_RULE_PARTNER_SECRET_<PARTNERID>   Shared secret for that partner.
 *
 * Multiple partners are supported; each has its own secret variable.
 *
 * Environment variables
 * ─────────────────────
 *   PARTNER_SIG_WINDOW_SECONDS   Maximum age of a signed request (default 300).
 */

import { createHmac, createHash, timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { sendError } from '../lib/response.js';

// ── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_WINDOW_SECONDS = 300;

function sigWindowSeconds(): number {
  const raw = process.env.PARTNER_SIG_WINDOW_SECONDS;
  if (raw) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return DEFAULT_WINDOW_SECONDS;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface PartnerRequest extends Request {
  /** Authenticated partner identifier, set by `requirePartner`. */
  partnerId?: string;
}

// ── Secret resolution ──────────────────────────────────────────────────────

/**
 * Reads the shared secret for `partnerId` from the environment.
 * Returns `undefined` if not configured (partner is unknown).
 */
export function resolvePartnerSecret(partnerId: string): string | undefined {
  const key = `TRAVEL_RULE_PARTNER_SECRET_${partnerId.toUpperCase().replace(/-/g, '_')}`;
  return process.env[key];
}

// ── Signature helpers ──────────────────────────────────────────────────────

/**
 * Computes the expected HMAC-SHA-256 signature for a request.
 *
 * @param partnerId  - Caller's partner id.
 * @param timestamp  - Unix seconds string as supplied by the caller.
 * @param bodyHex    - Lowercase hex of the raw request body SHA-256.
 * @param secret     - The partner's shared secret.
 */
export function computeSignature(
  partnerId: string,
  timestamp: string,
  bodyHex: string,
  secret: string,
): string {
  const message = `${partnerId}:${timestamp}:${bodyHex}`;
  return createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * Computes the SHA-256 hex digest of a raw body buffer (or empty string).
 */
export function bodyDigest(rawBody: Buffer | string): string {
  const data = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Timing-safe string comparison for HMAC values.
 */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

// ── Middleware ─────────────────────────────────────────────────────────────

/**
 * Express middleware that mutually authenticates an inbound partner request.
 *
 * On success it sets `req.partnerId` and calls `next()`.
 * On failure it returns 401 or 403 with a structured error envelope.
 */
export function requirePartner(
  req: PartnerRequest,
  res: Response,
  next: NextFunction,
): void {
  const partnerId = req.headers['x-partner-id'];
  const signature = req.headers['x-partner-sig'];
  const timestamp = req.headers['x-partner-ts'];

  if (
    typeof partnerId !== 'string' || partnerId.trim() === '' ||
    typeof signature !== 'string' || signature.trim() === '' ||
    typeof timestamp !== 'string' || timestamp.trim() === ''
  ) {
    sendError(
      res,
      'MISSING_AUTH_HEADERS',
      'X-Partner-Id, X-Partner-Sig, and X-Partner-Ts headers are required',
      401,
    );
    return;
  }

  // ── Timestamp freshness ────────────────────────────────────────────────

  const tsNum = parseInt(timestamp, 10);
  if (isNaN(tsNum)) {
    sendError(res, 'INVALID_TIMESTAMP', 'X-Partner-Ts must be a numeric Unix timestamp', 401);
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const ageSecs = Math.abs(nowSeconds - tsNum);

  if (ageSecs > sigWindowSeconds()) {
    sendError(
      res,
      'REQUEST_EXPIRED',
      `Request timestamp is too old or too far in the future (window: ${sigWindowSeconds()} s)`,
      401,
    );
    return;
  }

  // ── Partner lookup ─────────────────────────────────────────────────────

  const secret = resolvePartnerSecret(partnerId);
  if (!secret) {
    sendError(res, 'UNKNOWN_PARTNER', 'Unrecognised partner id', 403);
    return;
  }

  // ── Signature verification ─────────────────────────────────────────────

  // The raw body must have been parsed before this middleware runs (or be empty).
  // We re-serialise from req.body when rawBody is absent for convenience.
  const rawBody: Buffer | string =
    (req as Request & { rawBody?: Buffer }).rawBody ??
    (req.body !== undefined ? JSON.stringify(req.body) : '');

  const digest = bodyDigest(rawBody);
  const expected = computeSignature(partnerId, timestamp, digest, secret);

  if (!safeCompare(expected, signature)) {
    sendError(res, 'INVALID_SIGNATURE', 'Request signature verification failed', 401);
    return;
  }

  req.partnerId = partnerId;
  next();
}

// ── Test helpers ───────────────────────────────────────────────────────────

/**
 * @internal
 * Registers a partner secret in the environment for unit tests.
 */
export function __registerTestPartner(partnerId: string, secret: string): void {
  const key = `TRAVEL_RULE_PARTNER_SECRET_${partnerId.toUpperCase().replace(/-/g, '_')}`;
  process.env[key] = secret;
}

/**
 * @internal
 * Removes a partner secret from the environment after a test.
 */
export function __unregisterTestPartner(partnerId: string): void {
  const key = `TRAVEL_RULE_PARTNER_SECRET_${partnerId.toUpperCase().replace(/-/g, '_')}`;
  delete process.env[key];
}
