import { jest } from '@jest/globals';
import { createHorizonBatcher, type FlushMetrics } from '../lib/horizonBatcher.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Single request ─────────────────────────────────────────────────────────

describe('createHorizonBatcher — single request', () => {
  it('resolves with the value returned by the underlying fetch', async () => {
    const fetcher = jest.fn(async (_path: string) => ({ ledger: 1 }));
    const batcher = createHorizonBatcher({ fetch: fetcher, coalesceMs: 5 });

    const result = await batcher.fetch<{ ledger: number }>('/ledgers/1');

    expect(result).toEqual({ ledger: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/ledgers/1');
  });

  it('rejects when the underlying fetch throws', async () => {
    const fetcher = jest.fn(async (_path: string): Promise<unknown> => {
      throw new Error('horizon 503');
    });
    const batcher = createHorizonBatcher({ fetch: fetcher, coalesceMs: 5 });

    await expect(batcher.fetch('/accounts/GABC')).rejects.toThrow('horizon 503');
  });
});

// ── Batching / coalescing ──────────────────────────────────────────────────

describe('createHorizonBatcher — coalescing', () => {
  it('issues a single upstream fetch for concurrent duplicate paths', async () => {
    const fetcher = jest.fn(async (_path: string) => ({ account: 'GABC' }));
    const batcher = createHorizonBatcher({ fetch: fetcher, coalesceMs: 20 });

    const [a, b, c] = await Promise.all([
      batcher.fetch('/accounts/GABC'),
      batcher.fetch('/accounts/GABC'),
      batcher.fetch('/accounts/GABC'),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ account: 'GABC' });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('issues parallel upstream fetches for distinct paths in the same window', async () => {
    const fetcher = jest.fn(async (path: string) => ({ path }));
    const batcher = createHorizonBatcher({ fetch: fetcher, coalesceMs: 20 });

    const [a, b] = await Promise.all([
      batcher.fetch('/accounts/GA'),
      batcher.fetch('/accounts/GB'),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((a as { path: string }).path).toBe('/accounts/GA');
    expect((b as { path: string }).path).toBe('/accounts/GB');
  });

  it('sends a new upstream request for the same path in a later window', async () => {
    const fetcher = jest.fn(async (_path: string) => ({ ts: Date.now() }));
    const batcher = createHorizonBatcher({ fetch: fetcher, coalesceMs: 5 });

    await batcher.fetch('/ledgers/latest');
    await delay(30);
    await batcher.fetch('/ledgers/latest');

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

// ── flush() ────────────────────────────────────────────────────────────────

describe('createHorizonBatcher — flush()', () => {
  it('flush() forces immediate dispatch without waiting for coalesceMs', async () => {
    const fetcher = jest.fn(async (_path: string) => 'ok');
    const batcher = createHorizonBatcher({ fetch: fetcher, coalesceMs: 60_000 });

    const promise = batcher.fetch('/accounts/GX');
    await batcher.flush();
    const result = await promise;

    expect(result).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('flush() on an empty batcher resolves immediately', async () => {
    const batcher = createHorizonBatcher({ fetch: jest.fn(async () => null), coalesceMs: 5 });
    await expect(batcher.flush()).resolves.toBeUndefined();
  });
});

// ── Metrics ────────────────────────────────────────────────────────────────

describe('createHorizonBatcher — stats()', () => {
  it('reports zero metrics on a freshly created batcher', () => {
    const batcher = createHorizonBatcher({ fetch: jest.fn(async () => null), coalesceMs: 5 });
    const s = batcher.stats();
    expect(s.totalRequests).toBe(0);
    expect(s.totalBatches).toBe(0);
    expect(s.totalCoalesced).toBe(0);
    expect(s.hitRate).toBe(0);
  });

  it('increments totalRequests for every call to fetch()', async () => {
    const fetcher = jest.fn(async () => null);
    const batcher = createHorizonBatcher({ fetch: fetcher, coalesceMs: 20 });

    await Promise.all([
      batcher.fetch('/a'),
      batcher.fetch('/a'),
      batcher.fetch('/b'),
    ]);

    expect(batcher.stats().totalRequests).toBe(3);
  });

  it('tracks coalesced count and hit rate correctly', async () => {
    const fetcher = jest.fn(async () => null);
    const batcher = createHorizonBatcher({ fetch: fetcher, coalesceMs: 20 });

    // 3 requests for /a → 2 coalesced; 1 request for /b → 0 coalesced
    await Promise.all([
      batcher.fetch('/a'),
      batcher.fetch('/a'),
      batcher.fetch('/a'),
      batcher.fetch('/b'),
    ]);

    const { totalRequests, totalBatches, totalCoalesced, hitRate } = batcher.stats();
    expect(totalRequests).toBe(4);
    expect(totalBatches).toBe(1);
    expect(totalCoalesced).toBe(2);
    expect(hitRate).toBeCloseTo(0.5);
  });

  it('invokes onFlush with correct batch-size and coalesced metrics', async () => {
    const flushEvents: FlushMetrics[] = [];
    const batcher = createHorizonBatcher({
      fetch: jest.fn(async () => null),
      coalesceMs: 20,
      onFlush: (m) => flushEvents.push(m),
    });

    await Promise.all([
      batcher.fetch('/a'),
      batcher.fetch('/a'),
      batcher.fetch('/b'),
    ]);

    expect(flushEvents).toHaveLength(1);
    expect(flushEvents[0]!.batchSize).toBe(2);
    expect(flushEvents[0]!.coalesced).toBe(1);
    expect(flushEvents[0]!.flushDurationMs).toBeGreaterThanOrEqual(0);
  });
});

// ── Error isolation ────────────────────────────────────────────────────────

describe('createHorizonBatcher — error isolation', () => {
  it('propagates errors to all waiters for the same failed path', async () => {
    const fetcher = jest.fn(async (_path: string): Promise<unknown> => {
      throw new Error('upstream error');
    });
    const batcher = createHorizonBatcher({ fetch: fetcher, coalesceMs: 20 });

    const results = await Promise.allSettled([
      batcher.fetch('/fail'),
      batcher.fetch('/fail'),
    ]);

    expect(results[0]!.status).toBe('rejected');
    expect(results[1]!.status).toBe('rejected');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not cancel successful paths when another path in the same batch fails', async () => {
    const fetcher = jest.fn(async (path: string): Promise<unknown> => {
      if (path === '/bad') throw new Error('bad');
      return { ok: true };
    });
    const batcher = createHorizonBatcher({ fetch: fetcher, coalesceMs: 20 });

    const [good, bad] = await Promise.allSettled([
      batcher.fetch('/good'),
      batcher.fetch('/bad'),
    ]);

    expect(good.status).toBe('fulfilled');
    expect(bad.status).toBe('rejected');
  });
});
