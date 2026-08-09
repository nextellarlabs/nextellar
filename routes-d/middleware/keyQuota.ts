/**
 * keyQuota — per-API-key request quota middleware.
 *
 * Behaviour:
 *   1. Extracts the API key from the request (Bearer / X-API-Key / query).
 *   2. If no valid key is found, returns 401.
 *   3. Calls consumeQuota() for that key.
 *   4. Attaches standard rate-limit headers to every response.
 *   5. If the quota is exhausted returns 429 with a Retry-After header and
 *      does NOT call next().
 *   6. If quota remains, calls next() so the request proceeds normally.
 *
 * Response headers (aligned with the IETF draft-ietf-httpapi-ratelimit-headers):
 *   X-RateLimit-Limit     — max requests per window
 *   X-RateLimit-Remaining — requests left in the current window
 *   X-RateLimit-Reset     — epoch seconds when the window resets
 *   Retry-After           — seconds until reset (only on 429)
 *
 * @example
 * ```ts
 * import { keyQuota } from '../middleware/keyQuota.js';
 *
 * // Default policy (1000 req / hour)
 * router.use(keyQuota());
 *
 * // Custom policy
 * router.use(keyQuota({ limit: 100, windowMs: 60_000 }));
 *
 * // Override policy per key before the middleware runs
 * import { setPolicy } from '../lib/quotaStore.js';
 * setPolicy('my-key', { limit: 500, windowMs: 60_000 });
 * ```
 */

import type { Request, Response, NextFunction } from 'express';
import { resolveApiKey, type ApiKeyOptions } from '../auth/apiKey.js';
import {
  consumeQuota,
  setPolicy,
  type QuotaPolicy,
  type QuotaBucket,
} from '../lib/quotaStore.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KeyQuotaOptions {
  /**
   * Default quota policy applied to keys that have no per-key override.
   * If omitted, the quotaStore DEFAULT_POLICY is used (1000 req / hour).
   */
  defaultPolicy?: QuotaPolicy;

  /**
   * Per-key policy overrides resolved at middleware creation time.
   * Merges with (and takes priority over) any policies already registered in
   * the store.
   */
  policies?: Record<string, QuotaPolicy>;

  /**
   * Options forwarded to resolveApiKey (e.g. a custom key pattern).
   */
  apiKeyOptions?: ApiKeyOptions;

  /**
   * When `true`, requests that carry no API key at all are passed through
   * without quota enforcement (anonymous access).  Defaults to `false`.
   */
  allowAnonymous?: boolean;
}

// ─── Header names ─────────────────────────────────────────────────────────────

const HEADER_LIMIT     = 'X-RateLimit-Limit';
const HEADER_REMAINING = 'X-RateLimit-Remaining';
const HEADER_RESET     = 'X-RateLimit-Reset';
const HEADER_RETRY     = 'Retry-After';

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Returns an Express middleware function that enforces per-API-key quotas.
 */
export function keyQuota(opts: KeyQuotaOptions = {}) {
  const {
    defaultPolicy,
    policies = {},
    apiKeyOptions = {},
    allowAnonymous = false,
  } = opts;

  // Register per-key policy overrides upfront.
  for (const [apiKey, policy] of Object.entries(policies)) {
    setPolicy(apiKey, policy);
  }

  // If a global default policy was provided, store it under a sentinel so
  // getBucket() picks it up for any key not explicitly overridden.
  // We keep this separate to avoid mutating the real DEFAULT_POLICY constant.
  // Instead we patch each unseen key when first encountered below.
  const resolvedDefaultPolicy: QuotaPolicy | undefined = defaultPolicy;

  return function keyQuotaMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const { key, error } = resolveApiKey(req, apiKeyOptions);

    // ── No API key present ──────────────────────────────────────────────────
    if (!key) {
      if (allowAnonymous) {
        next();
        return;
      }

      res.status(401).json({
        error: {
          code: 'MISSING_API_KEY',
          message: error ?? 'API key is required',
        },
      });
      return;
    }

    // ── Apply default policy if no per-key override exists and a custom
    //    default was given to this middleware instance. ─────────────────────
    if (resolvedDefaultPolicy) {
      // setPolicy is idempotent — if the caller already registered an override
      // via the `policies` map above it won't be clobbered because we only
      // apply resolvedDefaultPolicy for keys that aren't explicitly in `policies`.
      if (!(key in policies)) {
        setPolicy(key, resolvedDefaultPolicy);
      }
    }

    // ── Consume one request unit ────────────────────────────────────────────
    const { allowed, bucket } = consumeQuota(key);

    attachHeaders(res, bucket);

    if (!allowed) {
      const retryAfterSec = Math.ceil((bucket.resetAt - Date.now()) / 1000);
      res.setHeader(HEADER_RETRY, String(Math.max(0, retryAfterSec)));

      res.status(429).json({
        error: {
          code: 'QUOTA_EXCEEDED',
          message: 'API quota exceeded. Please retry after the reset window.',
          retryAfter: Math.max(0, retryAfterSec),
          resetAt: new Date(bucket.resetAt).toISOString(),
        },
      });
      return;
    }

    next();
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function attachHeaders(res: Response, bucket: QuotaBucket): void {
  res.setHeader(HEADER_LIMIT,     String(bucket.limit));
  res.setHeader(HEADER_REMAINING, String(bucket.remaining));
  // X-RateLimit-Reset is expressed as epoch seconds per convention.
  res.setHeader(HEADER_RESET, String(Math.ceil(bucket.resetAt / 1000)));
}
