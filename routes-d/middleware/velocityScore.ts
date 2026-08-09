/**
 * Velocity-Based Fraud Scoring Middleware
 *
 * Tracks request velocity per authenticated user and per IP address using
 * configurable sliding windows. Computes a fraud/velocity score that
 * considers request frequency, burst behavior, and natural window decay.
 * Optionally blocks requests when the score exceeds a configurable threshold.
 */

import type { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the velocity scoring middleware. */
export interface VelocityConfig {
  /** Sliding window duration in milliseconds. Default: 60_000 (1 minute). */
  windowSizeMs: number;
  /** Short burst detection sub-window in milliseconds. Default: 5_000 (5 s). */
  burstWindowMs: number;
  /** Multiplier applied to the burst ratio to amplify burst-based scores. */
  burstMultiplier: number;
  /**
   * Score threshold at or above which requests are automatically blocked.
   * Set to 0 to disable automatic blocking. Default: 0 (disabled).
   */
  blockThreshold: number;
  /**
   * Interval in milliseconds between cleanup sweeps that remove expired
   * timestamp entries and empty key buckets. Default: 60_000 (1 minute).
   */
  cleanupIntervalMs: number;
  /**
   * Maximum number of distinct keys (user + IP combinations) tracked
   * simultaneously. When exceeded the oldest inactive bucket is evicted.
   * Default: 100_000.
   */
  maxTrackedKeys: number;
}

/**
 * Result attached to every request that passes through the middleware.
 * Available on `req.velocityScore` for downstream handlers.
 */
export interface VelocityScoreResult {
  /** Computed velocity score for this request. */
  score: number;
  /** Number of requests from this user within the sliding window. */
  userCount: number;
  /** Number of requests from this IP within the sliding window. */
  ipCount: number;
  /** Whether the request was auto-blocked (only present when blocked). */
  blocked?: boolean;
  /** The threshold that was exceeded (only present when blocked). */
  threshold?: number;
  /** Timestamp of when the score was computed. */
  computedAt: string;
}

// ---------------------------------------------------------------------------
// Default configuration (overridable via env vars)
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: VelocityConfig = {
  windowSizeMs: parseInt(process.env.VELOCITY_WINDOW_MS ?? '60000', 10),
  burstWindowMs: parseInt(process.env.VELOCITY_BURST_WINDOW_MS ?? '5000', 10),
  burstMultiplier: parseFloat(process.env.VELOCITY_BURST_MULTIPLIER ?? '2.0'),
  blockThreshold: parseInt(process.env.VELOCITY_BLOCK_THRESHOLD ?? '0', 10),
  cleanupIntervalMs: parseInt(process.env.VELOCITY_CLEANUP_INTERVAL_MS ?? '60000', 10),
  maxTrackedKeys: parseInt(process.env.VELOCITY_MAX_TRACKED_KEYS ?? '100000', 10),
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** Per-key sliding-window buckets. Key format: "user:<id>" or "ip:<addr>". */
const buckets = new Map<string, number[]>();
/** Last-access time per key, used for eviction when maxTrackedKeys is hit. */
const lastAccess = new Map<string, number>();
/** Cleanup timer reference so we can tear down in tests. */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
/** Whether cleanup is currently running (prevents overlapping sweeps). */
let cleaning = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a stable, deduplicated key for a user bucket.
 * Returns `null` when no user identifier can be extracted.
 */
function getUserKey(req: Request): string | null {
  // Try common locations for a user identifier
  const userId =
    (req.body as Record<string, unknown> | undefined)?.userId ??
    req.headers['x-user-id'];
  if (typeof userId === 'string' && userId.trim().length > 0) {
    return `user:${userId.trim()}`;
  }
  return null;
}

/**
 * Returns a stable key for an IP bucket.
 * Returns `null` when no IP can be determined.
 */
function getIpKey(req: Request): string | null {
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
    req.ip ??
    req.socket.remoteAddress;
  if (typeof ip === 'string' && ip.trim().length > 0) {
    return `ip:${ip.trim()}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Compute a velocity score for a single bucket's timestamp history.
 *
 * The score is the number of requests in the window multiplied by a burst
 * factor. The burst factor amplifies the score when requests cluster
 * tightly in time.
 *
 * @param timestamps - Sorted array of epoch-ms timestamps (mutated in place).
 * @param now        - Current time in epoch ms.
 * @param config     - Active velocity configuration.
 * @returns The count of requests in the full window and the final score.
 */
function scoreBucket(
  timestamps: number[],
  now: number,
  config: VelocityConfig,
): { count: number; score: number } {
  const cutoff = now - config.windowSizeMs;

  // 1. Prune expired entries (sliding-window shift)
  let pruneIdx = 0;
  while (pruneIdx < timestamps.length && timestamps[pruneIdx] < cutoff) {
    pruneIdx++;
  }
  if (pruneIdx > 0) {
    timestamps.splice(0, pruneIdx);
  }

  const count = timestamps.length;
  if (count === 0) {
    return { count: 0, score: 0 };
  }

  // 2. Count requests in the burst sub-window
  const burstCutoff = now - config.burstWindowMs;
  let burstCount = 0;
  for (let i = timestamps.length - 1; i >= 0; i--) {
    if (timestamps[i] >= burstCutoff) {
      burstCount++;
    } else {
      break; // timestamps are sorted ascending
    }
  }

  // 3. Burst ratio: what fraction of total window traffic happened recently?
  const burstRatio = burstCount / count;

  // 4. Final score = count × (1 + burstRatio × (burstMultiplier - 1))
  //    When burstRatio = 0 → score = count (no burst bonus)
  //    When burstRatio = 1 → score = count × burstMultiplier (max burst)
  const score = Math.round(count * (1 + burstRatio * (config.burstMultiplier - 1)));

  return { count, score };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Evict a batch of the least-recently-used keys until the bucket count
 * is at or below the configured maximum.
 */
function evictLRU(maxKeys: number): void {
  if (buckets.size <= maxKeys) return;

  // Sort by last-access ascending (oldest first)
  const entries = Array.from(lastAccess.entries());
  entries.sort((a, b) => a[1] - b[1]);

  const toRemove = buckets.size - maxKeys;
  for (let i = 0; i < toRemove && i < entries.length; i++) {
    const key = entries[i][0];
    buckets.delete(key);
    lastAccess.delete(key);
  }
}

/**
 * Remove expired timestamps from every bucket and delete empty buckets.
 *
 * Called periodically and on-demand (e.g., in tests). Designed to be
 * safe for concurrent access via synchronous iteration.
 */
export function runCleanup(config: VelocityConfig = DEFAULT_CONFIG): void {
  if (cleaning) return;
  cleaning = true;

  try {
    const now = Date.now();
    const cutoff = now - config.windowSizeMs;

    for (const [key, timestamps] of buckets) {
      // Remove expired entries
      let pruneIdx = 0;
      while (pruneIdx < timestamps.length && timestamps[pruneIdx] < cutoff) {
        pruneIdx++;
      }
      if (pruneIdx > 0) {
        timestamps.splice(0, pruneIdx);
      }

      // Drop entirely empty buckets
      if (timestamps.length === 0) {
        buckets.delete(key);
        lastAccess.delete(key);
      }
    }

    // Enforce max-key cap
    evictLRU(config.maxTrackedKeys);
  } finally {
    cleaning = false;
  }
}

/**
 * Start the periodic cleanup interval.
 * Safe to call multiple times (idempotent).
 */
export function startCleanup(config: VelocityConfig = DEFAULT_CONFIG): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => runCleanup(config), config.cleanupIntervalMs);
  // Allow Node to exit even if the timer is still running
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

/**
 * Stop the periodic cleanup interval.
 */
export function stopCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Request augmentation
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      /** Velocity score result populated by the velocityScore middleware. */
      velocityScore?: VelocityScoreResult;
    }
  }
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create an Express middleware that applies velocity-based fraud scoring
 * to every request.
 *
 * The middleware:
 * 1. Extracts the authenticated user ID and client IP from the request.
 * 2. Updates per-user and per-IP sliding-window buckets.
 * 3. Computes a combined velocity score.
 * 4. Attaches the result to `req.velocityScore`.
 * 5. Optionally blocks (HTTP 429) when the score meets or exceeds
 *    `config.blockThreshold`.
 *
 * @param config - Partial configuration; merged with defaults.
 * @returns Express middleware function.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { velocityScoreMiddleware } from './middleware/velocityScore.js';
 *
 * const app = express();
 * app.use(velocityScoreMiddleware({ blockThreshold: 100 }));
 *
 * app.get('/api/data', (req, res) => {
 *   console.log('Velocity score:', req.velocityScore?.score);
 *   res.json({ ok: true });
 * });
 * ```
 */
export function velocityScoreMiddleware(
  config: Partial<VelocityConfig> = {},
): (req: Request, res: Response, next: NextFunction) => void {
  const effectiveConfig: VelocityConfig = { ...DEFAULT_CONFIG, ...config };

  // Ensure cleanup is running
  startCleanup(effectiveConfig);

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const userKey = getUserKey(req);
    const ipKey = getIpKey(req);

    // Compute individual bucket scores
    let userCount = 0;
    let userScore = 0;
    let ipCount = 0;
    let ipScore = 0;

    if (userKey) {
      const timestamps = buckets.get(userKey) ?? [];
      timestamps.push(now);
      buckets.set(userKey, timestamps);
      lastAccess.set(userKey, now);
      const result = scoreBucket(timestamps, now, effectiveConfig);
      userCount = result.count;
      userScore = result.score;
    }

    if (ipKey) {
      const timestamps = buckets.get(ipKey) ?? [];
      timestamps.push(now);
      buckets.set(ipKey, timestamps);
      lastAccess.set(ipKey, now);
      const result = scoreBucket(timestamps, now, effectiveConfig);
      ipCount = result.count;
      ipScore = result.score;
    }

    // Combined score: max of user and IP scores so one dimension can't hide
    // the other when both are present. When only one dimension is available
    // we use the single score plus a floor for the missing dimension.
    const combinedScore = Math.max(userScore, ipScore);

    // Build result
    const result: VelocityScoreResult = {
      score: combinedScore,
      userCount,
      ipCount,
      computedAt: new Date(now).toISOString(),
    };

    // Auto-block check
    if (
      effectiveConfig.blockThreshold > 0 &&
      combinedScore >= effectiveConfig.blockThreshold
    ) {
      result.blocked = true;
      result.threshold = effectiveConfig.blockThreshold;

      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Request rate exceeded. Please slow down.',
        },
        velocityScore: result,
      });
      return;
    }

    // Attach to request for downstream handlers
    req.velocityScore = result;

    next();
  };
}

// ---------------------------------------------------------------------------
// Test helpers — NOT for production use
// ---------------------------------------------------------------------------

/**
 * Reset all internal state. Intended for test teardown only.
 */
export function __resetBuckets(): void {
  buckets.clear();
  lastAccess.clear();
  stopCleanup();
}

/**
 * Directly inspect the raw bucket data. Intended for test assertions only.
 */
export function __getBuckets(): ReadonlyMap<string, readonly number[]> {
  return buckets;
}

/**
 * Return a frozen copy of the default config for test inspection.
 */
export function __getDefaultConfig(): Readonly<VelocityConfig> {
  return Object.freeze({ ...DEFAULT_CONFIG });
}
