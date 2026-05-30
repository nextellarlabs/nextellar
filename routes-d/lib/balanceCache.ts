// In-memory TTL cache for Horizon account balance lookups.
//
// Reduces Horizon load by serving recent balances from memory until the
// per-entry TTL expires. Callers can bypass with `forceRefresh: true`, and
// the cache exposes an explicit invalidation hook for outbound payments.

export interface CachedBalance {
  accountId: string;
  balances: BalanceEntry[];
  fetchedAt: number;
  expiresAt: number;
}

export interface BalanceEntry {
  assetType: string;
  assetCode?: string;
  assetIssuer?: string;
  balance: string;
}

export interface BalanceFetcher {
  (accountId: string): Promise<BalanceEntry[]>;
}

export interface BalanceCacheOptions {
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = Number(
  process.env.NEXTELLAR_BALANCE_CACHE_TTL_MS ?? 30_000,
);

export class BalanceCache {
  private readonly entries = new Map<string, CachedBalance>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: BalanceCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  async get(
    accountId: string,
    fetcher: BalanceFetcher,
    options: { forceRefresh?: boolean } = {},
  ): Promise<{ value: CachedBalance; fromCache: boolean }> {
    if (!options.forceRefresh) {
      const cached = this.entries.get(accountId);
      if (cached && cached.expiresAt > this.now()) {
        return { value: cached, fromCache: true };
      }
    }

    const balances = await fetcher(accountId);
    const fetchedAt = this.now();
    const entry: CachedBalance = {
      accountId,
      balances,
      fetchedAt,
      expiresAt: fetchedAt + this.ttlMs,
    };
    this.entries.set(accountId, entry);
    return { value: entry, fromCache: false };
  }

  invalidate(accountId: string): boolean {
    return this.entries.delete(accountId);
  }

  clear(): void {
    this.entries.clear();
  }

  peek(accountId: string): CachedBalance | undefined {
    return this.entries.get(accountId);
  }
}

export const balanceCache = new BalanceCache();
