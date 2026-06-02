/**
 * Coalescing batcher for Horizon path lookups.
 *
 * Requests that arrive within a short window (`coalesceMs`) for the same
 * path are collapsed into a single upstream fetch. Requests for distinct
 * paths within the same window are issued in parallel.
 *
 * This is intentionally path-level deduplication — callers that already
 * have distinct URLs (account, balance, operation) benefit without any
 * extra coordination.
 */

export interface HorizonBatcherOptions {
  /** Maximum milliseconds to wait before flushing a pending batch. Default: 10. */
  coalesceMs?: number;
  /** Underlying single-path fetch function. */
  fetch: (path: string) => Promise<unknown>;
  /** Invoked after each batch flush with size and timing metrics. */
  onFlush?: (metrics: FlushMetrics) => void;
}

export interface FlushMetrics {
  /** Distinct paths fetched in this batch. */
  batchSize: number;
  /** Requests that were deduplicated (same path, multiple callers). */
  coalesced: number;
  /** Wall-clock time spent executing the batch in milliseconds. */
  flushDurationMs: number;
}

export interface BatcherStats {
  /** Total calls to `fetch()` since creation. */
  totalRequests: number;
  /** Total batch flushes executed. */
  totalBatches: number;
  /** Total requests that were coalesced (shared an upstream fetch). */
  totalCoalesced: number;
  /** Fraction of requests that were coalesced: `totalCoalesced / totalRequests`. */
  hitRate: number;
}

export interface HorizonBatcher {
  /** Fetch a Horizon path, coalescing concurrent identical requests. */
  fetch<T = unknown>(path: string): Promise<T>;
  /** Return a snapshot of batch size and hit-rate metrics. */
  stats(): BatcherStats;
  /**
   * Immediately flush any pending batch without waiting for `coalesceMs`.
   * Useful in tests and graceful shutdown.
   */
  flush(): Promise<void>;
}

interface Waiter {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export function createHorizonBatcher(options: HorizonBatcherOptions): HorizonBatcher {
  const coalesceMs = options.coalesceMs ?? 10;

  let pending = new Map<string, Waiter[]>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  let totalRequests = 0;
  let totalBatches = 0;
  let totalCoalesced = 0;

  async function doFlush(): Promise<void> {
    if (pending.size === 0) return;

    // Snapshot and reset so new requests during async work go to the next batch.
    const batch = pending;
    pending = new Map();
    timer = null;

    const paths = [...batch.keys()];
    const totalWaiters = [...batch.values()].reduce((n, w) => n + w.length, 0);
    const coalesced = totalWaiters - paths.length;

    totalBatches += 1;
    totalCoalesced += coalesced;

    const start = Date.now();

    await Promise.all(
      paths.map(async (path) => {
        const waiters = batch.get(path)!;
        try {
          const result = await options.fetch(path);
          for (const w of waiters) w.resolve(result);
        } catch (err) {
          for (const w of waiters) w.reject(err);
        }
      }),
    );

    options.onFlush?.({
      batchSize: paths.length,
      coalesced,
      flushDurationMs: Date.now() - start,
    });
  }

  function scheduleFlush(): void {
    if (timer !== null) return;
    timer = setTimeout(() => {
      void doFlush();
    }, coalesceMs);
  }

  return {
    fetch<T = unknown>(path: string): Promise<T> {
      totalRequests += 1;
      return new Promise<T>((resolve, reject) => {
        const existing = pending.get(path);
        if (existing) {
          existing.push({ resolve: resolve as (v: unknown) => void, reject });
        } else {
          pending.set(path, [{ resolve: resolve as (v: unknown) => void, reject }]);
        }
        scheduleFlush();
      });
    },

    stats(): BatcherStats {
      return {
        totalRequests,
        totalBatches,
        totalCoalesced,
        hitRate: totalRequests > 0 ? totalCoalesced / totalRequests : 0,
      };
    },

    async flush(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await doFlush();
    },
  };
}
