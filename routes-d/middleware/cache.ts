export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Simple in‑memory TTL cache.
 * Used by the federation resolver to avoid repeated network lookups.
 */
export class TTLCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs: number = 5 * 60 * 1000) { // 5 minutes default
    this.defaultTtlMs = defaultTtlMs;
  }

  /** Get a cached value if it hasn't expired. */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Set a value with an optional custom TTL (ms). */
  set(key: string, value: T, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.store.set(key, { value, expiresAt });
  }

  /** Invalidate a cached entry. */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Clear all entries (useful for tests). */
  clear(): void {
    this.store.clear();
  }
}
