// Redis-backed cache for hot Nextellar account data (profile, tier, trust state).
//
// Cache keys:
//   account:<accountId>:profile   – serialised AccountProfile JSON
//   account:<accountId>:tier      – serialised AccountTier JSON
//   account:<accountId>:trust     – serialised TrustState JSON
//
// TTL is configured via ACCOUNT_CACHE_TTL_SECS (default 120 s).

import { getRedisClient, type IRedisClient } from "./redisClient.js";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface AccountProfile {
  accountId: string;
  displayName: string;
  email: string;
  updatedAt: string;
}

export interface AccountTier {
  accountId: string;
  tier: "free" | "pro" | "enterprise";
  validUntil: string | null;
}

export interface TrustState {
  accountId: string;
  trusted: boolean;
  reason: string | null;
  evaluatedAt: string;
}

// ---------------------------------------------------------------------------
// Cache key helpers
// ---------------------------------------------------------------------------

function profileKey(accountId: string): string {
  return `account:${accountId}:profile`;
}

function tierKey(accountId: string): string {
  return `account:${accountId}:tier`;
}

function trustKey(accountId: string): string {
  return `account:${accountId}:trust`;
}

// ---------------------------------------------------------------------------
// Fetcher type
// ---------------------------------------------------------------------------

export interface AccountFetchers {
  fetchProfile(accountId: string): Promise<AccountProfile>;
  fetchTier(accountId: string): Promise<AccountTier>;
  fetchTrust(accountId: string): Promise<TrustState>;
}

// ---------------------------------------------------------------------------
// AccountCache
// ---------------------------------------------------------------------------

const DEFAULT_TTL_SECS = Number(process.env.ACCOUNT_CACHE_TTL_SECS ?? 120);

export interface AccountCacheOptions {
  ttlSecs?: number;
  client?: IRedisClient;
}

export class AccountCache {
  private readonly ttlSecs: number;
  private readonly client: IRedisClient;

  constructor(options: AccountCacheOptions = {}) {
    this.ttlSecs = options.ttlSecs ?? DEFAULT_TTL_SECS;
    this.client = options.client ?? getRedisClient();
  }

  // ── Profile ──────────────────────────────────────────────────────────────

  async getProfile(
    accountId: string,
    fetcher: AccountFetchers["fetchProfile"],
    forceRefresh = false,
  ): Promise<{ value: AccountProfile; fromCache: boolean }> {
    return this.getOrFetch(profileKey(accountId), fetcher.bind(null, accountId), forceRefresh);
  }

  async invalidateProfile(accountId: string): Promise<void> {
    await this.client.del(profileKey(accountId));
  }

  // ── Tier ─────────────────────────────────────────────────────────────────

  async getTier(
    accountId: string,
    fetcher: AccountFetchers["fetchTier"],
    forceRefresh = false,
  ): Promise<{ value: AccountTier; fromCache: boolean }> {
    return this.getOrFetch(tierKey(accountId), fetcher.bind(null, accountId), forceRefresh);
  }

  async invalidateTier(accountId: string): Promise<void> {
    await this.client.del(tierKey(accountId));
  }

  // ── Trust state ───────────────────────────────────────────────────────────

  async getTrust(
    accountId: string,
    fetcher: AccountFetchers["fetchTrust"],
    forceRefresh = false,
  ): Promise<{ value: TrustState; fromCache: boolean }> {
    return this.getOrFetch(trustKey(accountId), fetcher.bind(null, accountId), forceRefresh);
  }

  async invalidateTrust(accountId: string): Promise<void> {
    await this.client.del(trustKey(accountId));
  }

  // ── Full-account invalidation ─────────────────────────────────────────────

  /** Remove all cached data for an account (call on any account update). */
  async invalidateAccount(accountId: string): Promise<void> {
    await this.client.del(
      profileKey(accountId),
      tierKey(accountId),
      trustKey(accountId),
    );
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    forceRefresh: boolean,
  ): Promise<{ value: T; fromCache: boolean }> {
    if (!forceRefresh) {
      const cached = await this.client.get(key);
      if (cached !== null) {
        return { value: JSON.parse(cached) as T, fromCache: true };
      }
    }

    const value = await fetcher();
    await this.client.set(key, JSON.stringify(value), "EX", this.ttlSecs);
    return { value, fromCache: false };
  }
}

export const accountCache = new AccountCache();
