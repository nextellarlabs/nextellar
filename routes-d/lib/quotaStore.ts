/**
 * In-memory per-API-key quota store.
 *
 * Each API key is allocated a fixed number of requests per rolling window.
 * Window resets are handled lazily on each access so no background timers are
 * required, but an optional explicit reset function is also exported.
 *
 * All mutations are synchronous — Node.js is single-threaded so we get
 * serialised access for free without locks.
 */

export interface QuotaPolicy {
  /** Maximum requests allowed per window. */
  limit: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}

export interface QuotaBucket {
  /** API key this bucket belongs to. */
  key: string;
  /** Requests remaining in the current window. */
  remaining: number;
  /** Epoch ms when the current window was opened. */
  windowStart: number;
  /** Epoch ms when the current window expires (windowStart + windowMs). */
  resetAt: number;
  /** Total requests allowed per window (copied from policy). */
  limit: number;
  /** Window duration in ms (copied from policy). */
  windowMs: number;
}

export const DEFAULT_POLICY: QuotaPolicy = {
  limit: 1000,
  windowMs: 60 * 60 * 1000, // 1 hour
};

// ─── Internal state ─────────────────────────────────────────────────────────

/** Per-key quota buckets. */
const store = new Map<string, QuotaBucket>();

/** Per-key policy overrides. When absent, DEFAULT_POLICY is used. */
const policies = new Map<string, QuotaPolicy>();

// ─── Policy management ───────────────────────────────────────────────────────

/**
 * Register a custom quota policy for a specific API key.
 * Must be called before the first request for the key to take effect on that
 * window; changing a policy mid-window only affects the next window.
 */
export function setPolicy(apiKey: string, policy: QuotaPolicy): void {
  if (policy.limit < 1) {
    throw new RangeError('quota limit must be >= 1');
  }
  if (policy.windowMs < 1) {
    throw new RangeError('quota windowMs must be >= 1');
  }
  policies.set(apiKey, { ...policy });
}

/**
 * Remove a custom policy, reverting the key to DEFAULT_POLICY on next access.
 */
export function removePolicy(apiKey: string): void {
  policies.delete(apiKey);
}

/**
 * Return the effective policy for an API key.
 */
export function getPolicy(apiKey: string): QuotaPolicy {
  return policies.get(apiKey) ?? DEFAULT_POLICY;
}

// ─── Bucket helpers ──────────────────────────────────────────────────────────

/**
 * Build a fresh bucket for the given key using its current policy and the
 * provided window-start timestamp.
 */
function newBucket(apiKey: string, windowStart: number): QuotaBucket {
  const policy = getPolicy(apiKey);
  return {
    key: apiKey,
    remaining: policy.limit,
    windowStart,
    resetAt: windowStart + policy.windowMs,
    limit: policy.limit,
    windowMs: policy.windowMs,
  };
}

/**
 * Return a read-only snapshot of the current bucket for a key, creating one
 * if none exists. The bucket is refreshed when the window has expired.
 *
 * This does NOT decrement the counter.
 */
export function getBucket(apiKey: string): QuotaBucket {
  const now = Date.now();
  const existing = store.get(apiKey);

  if (!existing || now >= existing.resetAt) {
    const bucket = newBucket(apiKey, now);
    store.set(apiKey, bucket);
    return { ...bucket };
  }

  return { ...existing };
}

/**
 * Attempt to consume one request unit from the key's quota.
 *
 * Returns the updated bucket snapshot.
 * If `remaining` is 0 before the call, the count is NOT decremented further —
 * `remaining` stays at 0 and callers should check `allowed`.
 *
 * @returns `{ allowed: boolean, bucket: QuotaBucket }`
 */
export function consumeQuota(apiKey: string): { allowed: boolean; bucket: QuotaBucket } {
  const now = Date.now();
  let bucket = store.get(apiKey);

  // Initialise or reset an expired window
  if (!bucket || now >= bucket.resetAt) {
    bucket = newBucket(apiKey, now);
  }

  if (bucket.remaining <= 0) {
    store.set(apiKey, bucket);
    return { allowed: false, bucket: { ...bucket } };
  }

  bucket.remaining -= 1;
  store.set(apiKey, bucket);
  return { allowed: true, bucket: { ...bucket } };
}

/**
 * Forcefully reset the quota window for a given key, starting a fresh window
 * from now. Useful for admin overrides or test teardown.
 */
export function resetQuota(apiKey: string): QuotaBucket {
  const bucket = newBucket(apiKey, Date.now());
  store.set(apiKey, bucket);
  return { ...bucket };
}

/**
 * Delete all quota state for a key (bucket + policy).
 * The next access will create a new bucket from DEFAULT_POLICY.
 */
export function deleteKey(apiKey: string): void {
  store.delete(apiKey);
  policies.delete(apiKey);
}

/**
 * Return quota snapshots for all keys currently tracked in the store.
 */
export function getAllBuckets(): QuotaBucket[] {
  const now = Date.now();
  return Array.from(store.values()).map((b) => {
    // Return a snapshot; expired windows are represented as-is (no implicit reset here).
    const expired = now >= b.resetAt;
    return expired ? { ...b, remaining: getPolicy(b.key).limit } : { ...b };
  });
}

/**
 * Wipe all in-memory state.  Intended for test teardown only.
 */
export function __resetStore(): void {
  store.clear();
  policies.clear();
}
