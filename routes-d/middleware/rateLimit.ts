import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * In-process sliding-window rate limiter used to slow brute-force attempts
 * against the login route (Issue #256).
 *
 * Two keys are tracked independently so an attacker cannot defeat the limit
 * by spraying many IPs at a single account, nor by rotating accounts behind
 * a single IP:
 *
 *   - per IP        — caps total login attempts from a single source.
 *   - per IP+email  — caps attempts against a specific account from a
 *                     single source so a leaked password list still gets
 *                     slowed even when the IPs are distributed.
 *
 * Thresholds are configurable via env vars; the constructor accepts an
 * options bag so tests can drive the limiter deterministically.
 *
 * This is intentionally an in-memory implementation — production
 * deployments are expected to swap in a Redis-backed store that exposes
 * the same `hit` shape. Keeping the surface narrow makes that swap a
 * one-file change.
 */

export interface RateLimitOptions {
  /** Max attempts per window per key. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
  /** Injectable clock so tests can advance time deterministically. */
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Number of remaining attempts in the current window after this hit. */
  remaining: number;
  /** Milliseconds until the oldest in-window attempt rolls off. */
  retryAfterMs: number;
}

interface Bucket {
  /** Timestamps (ms) of attempts that fall inside the window. */
  hits: number[];
}

export class SlidingWindowLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly options: RateLimitOptions) {
    if (options.limit <= 0) {
      throw new Error('rate limit must be > 0');
    }
    if (options.windowMs <= 0) {
      throw new Error('rate limit windowMs must be > 0');
    }
  }

  /**
   * Record an attempt for `key` and return whether it should be allowed.
   * The hit is recorded regardless of the verdict — that way a caller who
   * keeps retrying past the limit only pushes their retry-after further
   * out, instead of being granted a fresh quota the moment one hit falls
   * off the window.
   */
  hit(key: string): RateLimitDecision {
    const now = this.now();
    const cutoff = now - this.options.windowMs;
    const bucket = this.buckets.get(key) ?? { hits: [] };

    // Drop attempts that are older than the window.
    bucket.hits = bucket.hits.filter((t) => t > cutoff);
    bucket.hits.push(now);
    this.buckets.set(key, bucket);

    const allowed = bucket.hits.length <= this.options.limit;
    const remaining = Math.max(0, this.options.limit - bucket.hits.length);
    const oldest = bucket.hits[0] ?? now;
    const retryAfterMs = allowed
      ? 0
      : Math.max(0, oldest + this.options.windowMs - now);

    return { allowed, remaining, retryAfterMs };
  }

  /** Test helper — wipe state between cases. */
  reset(): void {
    this.buckets.clear();
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }
}

const DEFAULT_IP_LIMIT = 20;
const DEFAULT_IP_EMAIL_LIMIT = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Build a limiter pair from environment variables. Designed so the route
 * file is a one-liner — `loginRateLimit()` — with sensible defaults that
 * still work in CI where the env vars aren't set.
 */
export function rateLimitConfigFromEnv(): {
  ipLimiter: SlidingWindowLimiter;
  ipEmailLimiter: SlidingWindowLimiter;
} {
  const windowMs = parsePositiveInt(
    process.env.NEXTELLAR_LOGIN_RATE_WINDOW_MS,
    DEFAULT_WINDOW_MS,
  );
  const ipLimit = parsePositiveInt(
    process.env.NEXTELLAR_LOGIN_RATE_IP_LIMIT,
    DEFAULT_IP_LIMIT,
  );
  const ipEmailLimit = parsePositiveInt(
    process.env.NEXTELLAR_LOGIN_RATE_IP_EMAIL_LIMIT,
    DEFAULT_IP_EMAIL_LIMIT,
  );
  return {
    ipLimiter: new SlidingWindowLimiter({ limit: ipLimit, windowMs }),
    ipEmailLimiter: new SlidingWindowLimiter({ limit: ipEmailLimit, windowMs }),
  };
}

export interface LoginRateLimitOptions {
  ipLimiter?: SlidingWindowLimiter;
  ipEmailLimiter?: SlidingWindowLimiter;
  /** Pull a normalised email from the request body. */
  getEmail?: (req: Request) => string;
  /** Pull a stable client IP. */
  getIp?: (req: Request) => string;
}

function defaultGetEmail(req: Request): string {
  const value = (req.body as { email?: unknown } | undefined)?.email;
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function defaultGetIp(req: Request): string {
  // Trust the Express-resolved IP (which honours `app.set('trust proxy', …)`
  // when the deployment configures it). Fall back to the socket address so a
  // misconfigured proxy still produces *some* key rather than collapsing
  // every caller into the empty string.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Express middleware enforcing the login rate limit. Returns 429 with
 * `Retry-After` (seconds, per RFC 7231) when either bucket overflows.
 */
export function loginRateLimit(
  options: LoginRateLimitOptions = {},
): RequestHandler {
  const { ipLimiter, ipEmailLimiter } = (() => {
    if (options.ipLimiter && options.ipEmailLimiter) {
      return {
        ipLimiter: options.ipLimiter,
        ipEmailLimiter: options.ipEmailLimiter,
      };
    }
    const built = rateLimitConfigFromEnv();
    return {
      ipLimiter: options.ipLimiter ?? built.ipLimiter,
      ipEmailLimiter: options.ipEmailLimiter ?? built.ipEmailLimiter,
    };
  })();

  const getEmail = options.getEmail ?? defaultGetEmail;
  const getIp = options.getIp ?? defaultGetIp;

  return function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const ip = getIp(req);
    const email = getEmail(req);

    const ipDecision = ipLimiter.hit(`ip:${ip}`);
    // Only key per-email when the request actually carries one — an empty
    // email key would otherwise lump all bodyless requests together.
    const ipEmailDecision = email
      ? ipEmailLimiter.hit(`ip:${ip}|email:${email}`)
      : { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterMs: 0 };

    if (!ipDecision.allowed || !ipEmailDecision.allowed) {
      const retryAfterMs = Math.max(
        ipDecision.retryAfterMs,
        ipEmailDecision.retryAfterMs,
      );
      const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: 'too many requests',
        retryAfter: retryAfterSec,
      });
      return;
    }

    next();
  };
}
