import { AccountCache } from "../lib/accountCache.js";
import { InMemoryRedisClient } from "../lib/redisClient.js";
import type {
  AccountProfile,
  AccountTier,
  TrustState,
} from "../lib/accountCache.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProfile(accountId = "acc-1"): AccountProfile {
  return {
    accountId,
    displayName: "Alice",
    email: "alice@example.com",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function makeTier(accountId = "acc-1"): AccountTier {
  return { accountId, tier: "pro", validUntil: "2027-01-01T00:00:00Z" };
}

function makeTrust(accountId = "acc-1"): TrustState {
  return {
    accountId,
    trusted: true,
    reason: null,
    evaluatedAt: "2026-01-01T00:00:00Z",
  };
}

function buildCache(ttlSecs = 120) {
  const client = new InMemoryRedisClient();
  const cache = new AccountCache({ ttlSecs, client });
  return { cache, client };
}

// ---------------------------------------------------------------------------
// Profile — cache hit / miss / invalidation
// ---------------------------------------------------------------------------

describe("AccountCache – profile", () => {
  it("calls the fetcher on a cache miss and returns fromCache: false", async () => {
    const { cache } = buildCache();
    const fetcher = jest.fn().mockResolvedValue(makeProfile());

    const result = await cache.getProfile("acc-1", fetcher);

    expect(result.fromCache).toBe(false);
    expect(result.value.displayName).toBe("Alice");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns fromCache: true and skips the fetcher on a cache hit", async () => {
    const { cache } = buildCache();
    const fetcher = jest.fn().mockResolvedValue(makeProfile());

    await cache.getProfile("acc-1", fetcher);
    const second = await cache.getProfile("acc-1", fetcher);

    expect(second.fromCache).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after invalidateProfile", async () => {
    const { cache } = buildCache();
    const fetcher = jest.fn().mockResolvedValue(makeProfile());

    await cache.getProfile("acc-1", fetcher);
    await cache.invalidateProfile("acc-1");
    const result = await cache.getProfile("acc-1", fetcher);

    expect(result.fromCache).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("bypasses cache when forceRefresh is true", async () => {
    const { cache } = buildCache();
    const fetcher = jest.fn().mockResolvedValue(makeProfile());

    await cache.getProfile("acc-1", fetcher);
    const result = await cache.getProfile("acc-1", fetcher, true);

    expect(result.fromCache).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Tier
// ---------------------------------------------------------------------------

describe("AccountCache – tier", () => {
  it("misses on first call then hits on second", async () => {
    const { cache } = buildCache();
    const fetcher = jest.fn().mockResolvedValue(makeTier());

    const miss = await cache.getTier("acc-1", fetcher);
    const hit = await cache.getTier("acc-1", fetcher);

    expect(miss.fromCache).toBe(false);
    expect(hit.fromCache).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after invalidateTier", async () => {
    const { cache } = buildCache();
    const fetcher = jest.fn().mockResolvedValue(makeTier());

    await cache.getTier("acc-1", fetcher);
    await cache.invalidateTier("acc-1");
    await cache.getTier("acc-1", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Trust state
// ---------------------------------------------------------------------------

describe("AccountCache – trust", () => {
  it("misses on first call then hits on second", async () => {
    const { cache } = buildCache();
    const fetcher = jest.fn().mockResolvedValue(makeTrust());

    const miss = await cache.getTrust("acc-1", fetcher);
    const hit = await cache.getTrust("acc-1", fetcher);

    expect(miss.fromCache).toBe(false);
    expect(hit.fromCache).toBe(true);
  });

  it("re-fetches after invalidateTrust", async () => {
    const { cache } = buildCache();
    const fetcher = jest.fn().mockResolvedValue(makeTrust());

    await cache.getTrust("acc-1", fetcher);
    await cache.invalidateTrust("acc-1");
    await cache.getTrust("acc-1", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Full-account invalidation
// ---------------------------------------------------------------------------

describe("AccountCache – invalidateAccount", () => {
  it("removes all three keys so subsequent calls all miss", async () => {
    const { cache } = buildCache();
    const profileFetcher = jest.fn().mockResolvedValue(makeProfile());
    const tierFetcher = jest.fn().mockResolvedValue(makeTier());
    const trustFetcher = jest.fn().mockResolvedValue(makeTrust());

    // Populate all three caches
    await cache.getProfile("acc-1", profileFetcher);
    await cache.getTier("acc-1", tierFetcher);
    await cache.getTrust("acc-1", trustFetcher);

    await cache.invalidateAccount("acc-1");

    const profile = await cache.getProfile("acc-1", profileFetcher);
    const tier = await cache.getTier("acc-1", tierFetcher);
    const trust = await cache.getTrust("acc-1", trustFetcher);

    expect(profile.fromCache).toBe(false);
    expect(tier.fromCache).toBe(false);
    expect(trust.fromCache).toBe(false);
    expect(profileFetcher).toHaveBeenCalledTimes(2);
    expect(tierFetcher).toHaveBeenCalledTimes(2);
    expect(trustFetcher).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Account isolation — separate accounts do not share cache entries
// ---------------------------------------------------------------------------

describe("AccountCache – isolation", () => {
  it("caches accounts independently", async () => {
    const { cache } = buildCache();
    const f1 = jest.fn().mockResolvedValue(makeProfile("acc-1"));
    const f2 = jest.fn().mockResolvedValue(makeProfile("acc-2"));

    await cache.getProfile("acc-1", f1);
    await cache.getProfile("acc-2", f2);

    // Both should be cached now
    const hit1 = await cache.getProfile("acc-1", f1);
    const hit2 = await cache.getProfile("acc-2", f2);

    expect(hit1.fromCache).toBe(true);
    expect(hit2.fromCache).toBe(true);
    expect(f1).toHaveBeenCalledTimes(1);
    expect(f2).toHaveBeenCalledTimes(1);
  });

  it("invalidating one account does not affect another", async () => {
    const { cache } = buildCache();
    const f1 = jest.fn().mockResolvedValue(makeProfile("acc-1"));
    const f2 = jest.fn().mockResolvedValue(makeProfile("acc-2"));

    await cache.getProfile("acc-1", f1);
    await cache.getProfile("acc-2", f2);

    await cache.invalidateAccount("acc-1");

    const miss = await cache.getProfile("acc-1", f1);
    const hit = await cache.getProfile("acc-2", f2);

    expect(miss.fromCache).toBe(false);
    expect(hit.fromCache).toBe(true);
  });
});
