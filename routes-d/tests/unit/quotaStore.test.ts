/**
 * Unit tests for routes-d/lib/quotaStore.ts
 *
 * Covers:
 *   - Under-quota: consumeQuota decrements remaining, allows the request
 *   - Exhaust: 0 remaining → not allowed, remaining stays at 0
 *   - Reset: resetQuota starts a fresh window with full remaining
 *   - Window expiry: expired window is refreshed on next access
 *   - Policy management: setPolicy / getPolicy / removePolicy
 *   - deleteKey: removes both bucket and policy
 *   - getAllBuckets: reflects all tracked keys
 *   - Concurrent-style calls: rapid sequence stays coherent
 */

import {
  consumeQuota,
  getBucket,
  resetQuota,
  deleteKey,
  setPolicy,
  removePolicy,
  getPolicy,
  getAllBuckets,
  __resetStore,
  DEFAULT_POLICY,
  type QuotaPolicy,
} from '../../lib/quotaStore.js';

const VALID_KEY = 'test-api-key-0000000';
const OTHER_KEY = 'other-api-key-000000';

describe('quotaStore', () => {
  beforeEach(() => {
    __resetStore();
  });

  // ── getBucket ──────────────────────────────────────────────────────────────

  describe('getBucket', () => {
    it('creates a fresh bucket on first access', () => {
      const bucket = getBucket(VALID_KEY);

      expect(bucket.key).toBe(VALID_KEY);
      expect(bucket.remaining).toBe(DEFAULT_POLICY.limit);
      expect(bucket.limit).toBe(DEFAULT_POLICY.limit);
      expect(bucket.windowMs).toBe(DEFAULT_POLICY.windowMs);
      expect(bucket.resetAt).toBeGreaterThan(Date.now());
    });

    it('returns an immutable snapshot (does not expose internal reference)', () => {
      const b1 = getBucket(VALID_KEY);
      b1.remaining = 0; // mutate the snapshot

      const b2 = getBucket(VALID_KEY);
      expect(b2.remaining).toBe(DEFAULT_POLICY.limit); // internal state unchanged
    });

    it('reflects a custom policy', () => {
      const policy: QuotaPolicy = { limit: 50, windowMs: 5_000 };
      setPolicy(VALID_KEY, policy);

      const bucket = getBucket(VALID_KEY);
      expect(bucket.limit).toBe(50);
      expect(bucket.windowMs).toBe(5_000);
      expect(bucket.remaining).toBe(50);
    });
  });

  // ── consumeQuota (under-quota) ─────────────────────────────────────────────

  describe('consumeQuota — under quota', () => {
    it('returns allowed=true for the first request', () => {
      const { allowed, bucket } = consumeQuota(VALID_KEY);

      expect(allowed).toBe(true);
      expect(bucket.remaining).toBe(DEFAULT_POLICY.limit - 1);
    });

    it('decrements remaining by 1 on each call', () => {
      for (let i = 0; i < 5; i++) {
        consumeQuota(VALID_KEY);
      }
      const bucket = getBucket(VALID_KEY);
      expect(bucket.remaining).toBe(DEFAULT_POLICY.limit - 5);
    });

    it('attaches correct limit and windowMs to the returned bucket', () => {
      const { bucket } = consumeQuota(VALID_KEY);
      expect(bucket.limit).toBe(DEFAULT_POLICY.limit);
      expect(bucket.windowMs).toBe(DEFAULT_POLICY.windowMs);
    });

    it('returns different buckets for different keys', () => {
      consumeQuota(VALID_KEY);
      consumeQuota(VALID_KEY);
      consumeQuota(OTHER_KEY);

      expect(getBucket(VALID_KEY).remaining).toBe(DEFAULT_POLICY.limit - 2);
      expect(getBucket(OTHER_KEY).remaining).toBe(DEFAULT_POLICY.limit - 1);
    });
  });

  // ── consumeQuota (exhaust) ─────────────────────────────────────────────────

  describe('consumeQuota — exhausting the quota', () => {
    it('returns allowed=false when limit is 1 and it has been used', () => {
      setPolicy(VALID_KEY, { limit: 1, windowMs: 60_000 });

      const first = consumeQuota(VALID_KEY);
      expect(first.allowed).toBe(true);
      expect(first.bucket.remaining).toBe(0);

      const second = consumeQuota(VALID_KEY);
      expect(second.allowed).toBe(false);
      expect(second.bucket.remaining).toBe(0);
    });

    it('remaining does not go below 0', () => {
      setPolicy(VALID_KEY, { limit: 2, windowMs: 60_000 });

      consumeQuota(VALID_KEY);
      consumeQuota(VALID_KEY);
      // Third call should be denied
      const { allowed, bucket } = consumeQuota(VALID_KEY);

      expect(allowed).toBe(false);
      expect(bucket.remaining).toBe(0);
    });

    it('returns correct resetAt in the exhausted bucket', () => {
      setPolicy(VALID_KEY, { limit: 1, windowMs: 10_000 });
      consumeQuota(VALID_KEY);

      const before = Date.now();
      const { bucket } = consumeQuota(VALID_KEY);
      const after = Date.now();

      expect(bucket.resetAt).toBeGreaterThanOrEqual(before + 10_000 - 50);
      expect(bucket.resetAt).toBeLessThanOrEqual(after + 10_000 + 50);
    });
  });

  // ── resetQuota ─────────────────────────────────────────────────────────────

  describe('resetQuota', () => {
    it('restores full remaining after exhaust', () => {
      setPolicy(VALID_KEY, { limit: 2, windowMs: 60_000 });
      consumeQuota(VALID_KEY);
      consumeQuota(VALID_KEY);

      const reset = resetQuota(VALID_KEY);
      expect(reset.remaining).toBe(2);
    });

    it('starts a new window (resetAt > now)', () => {
      setPolicy(VALID_KEY, { limit: 5, windowMs: 60_000 });
      consumeQuota(VALID_KEY);

      const before = Date.now();
      const reset = resetQuota(VALID_KEY);
      expect(reset.resetAt).toBeGreaterThan(before);
    });

    it('allows requests again after reset', () => {
      setPolicy(VALID_KEY, { limit: 1, windowMs: 60_000 });
      consumeQuota(VALID_KEY);
      resetQuota(VALID_KEY);

      const { allowed } = consumeQuota(VALID_KEY);
      expect(allowed).toBe(true);
    });

    it('works on a key that was never accessed before', () => {
      const bucket = resetQuota('brand-new-key-12345');
      expect(bucket.remaining).toBe(DEFAULT_POLICY.limit);
    });
  });

  // ── Window expiry ──────────────────────────────────────────────────────────

  describe('window expiry', () => {
    it('automatically resets the window when it has expired', () => {
      // Use a 1 ms window so it expires essentially immediately
      setPolicy(VALID_KEY, { limit: 5, windowMs: 1 });

      consumeQuota(VALID_KEY);
      consumeQuota(VALID_KEY);

      // Wait for the window to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const { allowed, bucket } = consumeQuota(VALID_KEY);
          expect(allowed).toBe(true);
          // Remaining should be (5 - 1) because we just consumed one in the new window
          expect(bucket.remaining).toBe(4);
          resolve();
        }, 10);
      });
    });
  });

  // ── Policy management ──────────────────────────────────────────────────────

  describe('setPolicy / getPolicy / removePolicy', () => {
    it('getPolicy returns DEFAULT_POLICY when no override exists', () => {
      const p = getPolicy('no-such-key-000000000');
      expect(p).toEqual(DEFAULT_POLICY);
    });

    it('setPolicy stores a custom policy', () => {
      setPolicy(VALID_KEY, { limit: 42, windowMs: 999 });
      const p = getPolicy(VALID_KEY);
      expect(p.limit).toBe(42);
      expect(p.windowMs).toBe(999);
    });

    it('setPolicy throws for limit < 1', () => {
      expect(() => setPolicy(VALID_KEY, { limit: 0, windowMs: 1000 })).toThrow();
    });

    it('setPolicy throws for windowMs < 1', () => {
      expect(() => setPolicy(VALID_KEY, { limit: 10, windowMs: 0 })).toThrow();
    });

    it('removePolicy reverts key to DEFAULT_POLICY', () => {
      setPolicy(VALID_KEY, { limit: 10, windowMs: 1000 });
      removePolicy(VALID_KEY);
      expect(getPolicy(VALID_KEY)).toEqual(DEFAULT_POLICY);
    });
  });

  // ── deleteKey ──────────────────────────────────────────────────────────────

  describe('deleteKey', () => {
    it('removes the bucket so next access starts fresh', () => {
      setPolicy(VALID_KEY, { limit: 3, windowMs: 60_000 });
      consumeQuota(VALID_KEY);
      consumeQuota(VALID_KEY);

      deleteKey(VALID_KEY);

      // Next bucket should be from DEFAULT_POLICY (policy was also removed)
      const bucket = getBucket(VALID_KEY);
      expect(bucket.remaining).toBe(DEFAULT_POLICY.limit);
    });

    it('is idempotent — deleting a non-existent key does not throw', () => {
      expect(() => deleteKey('nonexistent-key-000')).not.toThrow();
    });
  });

  // ── getAllBuckets ──────────────────────────────────────────────────────────

  describe('getAllBuckets', () => {
    it('returns an empty array before any key is accessed', () => {
      expect(getAllBuckets()).toHaveLength(0);
    });

    it('lists all accessed keys', () => {
      consumeQuota(VALID_KEY);
      consumeQuota(OTHER_KEY);

      const all = getAllBuckets();
      const keys = all.map((b) => b.key);
      expect(keys).toContain(VALID_KEY);
      expect(keys).toContain(OTHER_KEY);
    });

    it('does not include deleted keys', () => {
      consumeQuota(VALID_KEY);
      deleteKey(VALID_KEY);

      const all = getAllBuckets();
      expect(all.map((b) => b.key)).not.toContain(VALID_KEY);
    });
  });

  // ── Concurrent-style rapid calls ───────────────────────────────────────────

  describe('concurrent-style rapid calls', () => {
    it('correctly handles many sequential calls without going below 0', () => {
      const LIMIT = 10;
      setPolicy(VALID_KEY, { limit: LIMIT, windowMs: 60_000 });

      const results: boolean[] = [];
      for (let i = 0; i < LIMIT + 5; i++) {
        results.push(consumeQuota(VALID_KEY).allowed);
      }

      const allowed = results.filter(Boolean).length;
      const denied  = results.filter((r) => !r).length;

      expect(allowed).toBe(LIMIT);
      expect(denied).toBe(5);
      expect(getBucket(VALID_KEY).remaining).toBe(0);
    });

    it('all concurrent Promise.all calls are serialised correctly', async () => {
      const LIMIT = 20;
      setPolicy(VALID_KEY, { limit: LIMIT, windowMs: 60_000 });

      // Simulate concurrent promises — in Node they still run synchronously
      // between event-loop ticks so this validates the sequential guarantee.
      const results = await Promise.all(
        Array.from({ length: LIMIT + 3 }, () =>
          Promise.resolve(consumeQuota(VALID_KEY).allowed),
        ),
      );

      const allowed = results.filter(Boolean).length;
      expect(allowed).toBe(LIMIT);
    });
  });
});
