// Asset metadata cache with TTL-based expiration (Issue #285).
//
// Caches asset metadata fetched from issuer TOML files to reduce repeated
// lookups. Entries expire after a configurable TTL and are refreshed
// asynchronously in the background.

import { performance } from 'node:perf_hooks';

export interface AssetMetadata {
  code: string;
  issuer: string;
  name?: string;
  description?: string;
  image?: string;
  decimals?: number;
  [key: string]: unknown;
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  refreshedAt: number;
}

export interface AssetMetadataCache {
  get(key: string): AssetMetadata | undefined;
  set(key: string, value: AssetMetadata): void;
  has(key: string): boolean;
  clear(): void;
  size(): number;
  isStale(key: string): boolean;
}

export interface AssetMetadataCacheOptions {
  /** TTL in milliseconds (default: 1 hour) */
  ttlMs?: number;
  /** Maximum cache size (default: 1000) */
  maxSize?: number;
  /** Callback for async refresh (optional) */
  onRefresh?: (key: string, value: AssetMetadata) => Promise<void>;
}

/**
 * Create an in-memory asset metadata cache with TTL-based expiration.
 *
 * @param options Configuration options
 * @returns Cache instance with get/set/has/clear methods
 *
 * @example
 * const cache = createAssetMetadataCache({ ttlMs: 3600000 });
 * cache.set('USDC:GA5Z...', { code: 'USDC', issuer: 'GA5Z...', decimals: 6 });
 * const metadata = cache.get('USDC:GA5Z...');
 */
export function createAssetMetadataCache(
  options: AssetMetadataCacheOptions = {},
): AssetMetadataCache {
  const ttlMs = options.ttlMs ?? 3600000; // 1 hour default
  const maxSize = options.maxSize ?? 1000;
  const onRefresh = options.onRefresh;

  const store = new Map<string, CacheEntry<AssetMetadata>>();

  function isExpired(entry: CacheEntry<AssetMetadata>): boolean {
    return performance.now() > entry.expiresAt;
  }

  function scheduleRefresh(key: string, entry: CacheEntry<AssetMetadata>): void {
    if (!onRefresh) return;

    // Schedule refresh at 80% of TTL to avoid cache misses
    const refreshAt = entry.expiresAt - ttlMs * 0.2;
    const delayMs = Math.max(0, refreshAt - performance.now());

    setTimeout(async () => {
      try {
        await onRefresh(key, entry.value);
        // Update refresh timestamp on successful refresh
        entry.refreshedAt = performance.now();
        entry.expiresAt = performance.now() + ttlMs;
      } catch (err) {
        // Log but don't throw — cache remains valid until hard expiry
        console.error(`Failed to refresh asset metadata for ${key}:`, err);
      }
    }, delayMs);
  }

  return {
    get(key: string): AssetMetadata | undefined {
      const entry = store.get(key);
      if (!entry) return undefined;

      if (isExpired(entry)) {
        store.delete(key);
        return undefined;
      }

      return entry.value;
    },

    set(key: string, value: AssetMetadata): void {
      // Evict oldest entry if at capacity
      if (store.size >= maxSize && !store.has(key)) {
        const firstKey = store.keys().next().value;
        if (firstKey) store.delete(firstKey);
      }

      const now = performance.now();
      const entry: CacheEntry<AssetMetadata> = {
        value,
        expiresAt: now + ttlMs,
        refreshedAt: now,
      };

      store.set(key, entry);
      scheduleRefresh(key, entry);
    },

    has(key: string): boolean {
      const entry = store.get(key);
      if (!entry) return false;
      if (isExpired(entry)) {
        store.delete(key);
        return false;
      }
      return true;
    },

    clear(): void {
      store.clear();
    },

    size(): number {
      return store.size;
    },

    isStale(key: string): boolean {
      const entry = store.get(key);
      if (!entry) return true;
      // Consider stale if within 20% of TTL (refresh window)
      const staleThreshold = entry.expiresAt - ttlMs * 0.2;
      return performance.now() > staleThreshold;
    },
  };
}

/**
 * Query helper for asset metadata lookup with cache fallback.
 *
 * @param cache The metadata cache instance
 * @param key Cache key (typically "CODE:ISSUER")
 * @param fetcher Function to fetch metadata if not cached
 * @returns Cached or freshly fetched metadata
 *
 * @example
 * const metadata = await queryAssetMetadata(
 *   cache,
 *   'USDC:GA5Z...',
 *   async () => fetchFromToml('https://...')
 * );
 */
export async function queryAssetMetadata(
  cache: AssetMetadataCache,
  key: string,
  fetcher: () => Promise<AssetMetadata>,
): Promise<AssetMetadata> {
  // Return cached value if available and not stale
  const cached = cache.get(key);
  if (cached && !cache.isStale(key)) {
    return cached;
  }

  // Fetch fresh metadata
  const metadata = await fetcher();
  cache.set(key, metadata);
  return metadata;
}
