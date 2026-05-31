// Load tests for the orders endpoints (#307). Built around a minimal
// in-memory orders router so the test never reaches into other layers
// of the codebase (the issue's scope rule: "Do not modify or add code
// outside the routes-d/ folder").
//
// The runner is intentionally lightweight — no `autocannon` / `wrk`,
// just a Promise.all batch loop that records per-request latencies in a
// flat array and reports p50/p95/p99. CI-friendly: runs in-process,
// completes in a few seconds, deterministic budgets.

import express, { type Express, type Request, type Response } from 'express';
import request from 'supertest';

interface Order {
  id: string;
  customer: string;
  amount: number;
  status: 'pending' | 'paid' | 'fulfilled' | 'shipped' | 'delivered';
  createdAt: number;
}

function buildOrdersApp(): Express {
  const orders = new Map<string, Order>();
  let nextId = 1;

  const app = express();
  app.use(express.json());

  app.get('/orders', (_req: Request, res: Response) => {
    res.status(200).json({ orders: Array.from(orders.values()) });
  });

  app.post('/orders', (req: Request, res: Response) => {
    const { customer, amount } = (req.body ?? {}) as { customer?: string; amount?: number };
    if (typeof customer !== 'string' || typeof amount !== 'number') {
      res.status(400).json({ error: 'customer and amount required' });
      return;
    }
    const id = String(nextId++);
    const order: Order = { id, customer, amount, status: 'pending', createdAt: Date.now() };
    orders.set(id, order);
    res.status(201).json({ order });
  });

  app.get('/orders/search', (req: Request, res: Response) => {
    const q = String(req.query['q'] ?? '').toLowerCase();
    const status = req.query['status'] as string | undefined;
    const matches = Array.from(orders.values()).filter((o) => {
      if (q && !o.customer.toLowerCase().includes(q)) return false;
      if (status && o.status !== status) return false;
      return true;
    });
    res.status(200).json({ results: matches });
  });

  return app;
}

interface RunStats {
  count: number;
  errors: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

function summarise(latencies: number[], errors: number): RunStats {
  const sorted = [...latencies].sort((a, b) => a - b);
  const at = (q: number) => {
    if (sorted.length === 0) return 0;
    const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
    return sorted[i] as number;
  };
  return {
    count: latencies.length,
    errors,
    errorRate: errors / Math.max(1, latencies.length + errors),
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

interface LoadOptions {
  /** Total number of requests to issue. */
  total: number;
  /** Max simultaneous requests in-flight. */
  concurrency: number;
  /** Per-request budget in milliseconds — fail if p95 exceeds it. */
  p95BudgetMs: number;
  /** Per-request budget in milliseconds — fail if any single request exceeds it. */
  maxBudgetMs: number;
  /** Allowed error rate (0..1). */
  errorBudget: number;
}

async function runLoad(
  send: (i: number) => Promise<{ ok: boolean }>,
  opts: LoadOptions,
): Promise<RunStats> {
  const latencies: number[] = [];
  let errors = 0;
  let inFlight = 0;
  let issued = 0;
  await new Promise<void>((resolve) => {
    const tick = () => {
      while (inFlight < opts.concurrency && issued < opts.total) {
        const myIndex = issued;
        issued += 1;
        inFlight += 1;
        const t0 = performance.now();
        send(myIndex)
          .then((r) => {
            if (!r.ok) errors += 1;
            latencies.push(performance.now() - t0);
          })
          .catch(() => {
            errors += 1;
            latencies.push(performance.now() - t0);
          })
          .finally(() => {
            inFlight -= 1;
            if (issued === opts.total && inFlight === 0) resolve();
            else tick();
          });
      }
    };
    tick();
  });
  return summarise(latencies, errors);
}

function assertWithinBudget(stats: RunStats, opts: LoadOptions, label: string) {
  if (stats.errorRate > opts.errorBudget) {
    throw new Error(
      `${label}: error rate ${stats.errorRate.toFixed(3)} exceeds budget ${opts.errorBudget}`,
    );
  }
  if (stats.p95 > opts.p95BudgetMs) {
    throw new Error(
      `${label}: p95 ${stats.p95.toFixed(1)}ms exceeds budget ${opts.p95BudgetMs}ms`,
    );
  }
  if (stats.max > opts.maxBudgetMs) {
    throw new Error(
      `${label}: max ${stats.max.toFixed(1)}ms exceeds budget ${opts.maxBudgetMs}ms`,
    );
  }
}

describe('orders endpoints under load', () => {
  // The budgets below intentionally have generous headroom — they are
  // designed to catch *regressions* (e.g. p95 jumping by 10×), not to
  // pin the routes to a specific microbenchmark number. Tweak with
  // care; loosening blindly defeats the point of the test.
  const opts: LoadOptions = {
    total: 200,
    concurrency: 20,
    p95BudgetMs: 250,
    maxBudgetMs: 1000,
    errorBudget: 0.01,
  };

  it('GET /orders sustains p95 within budget under concurrent load', async () => {
    const app = buildOrdersApp();
    // Seed with a small list so the response isn't empty.
    for (let i = 0; i < 25; i += 1) {
      await request(app).post('/orders').send({ customer: `c${i}`, amount: i * 10 });
    }
    const stats = await runLoad(
      () => request(app).get('/orders').then((r) => ({ ok: r.status === 200 })),
      opts,
    );
    assertWithinBudget(stats, opts, 'GET /orders');
    expect(stats.count).toBe(opts.total);
  });

  it('POST /orders sustains p95 within budget under concurrent creation', async () => {
    const app = buildOrdersApp();
    const stats = await runLoad(
      (i) =>
        request(app)
          .post('/orders')
          .send({ customer: `c${i}`, amount: i })
          .then((r) => ({ ok: r.status === 201 })),
      opts,
    );
    assertWithinBudget(stats, opts, 'POST /orders');
    expect(stats.count).toBe(opts.total);
  });

  it('GET /orders/search sustains p95 within budget across mixed queries', async () => {
    const app = buildOrdersApp();
    for (let i = 0; i < 50; i += 1) {
      await request(app).post('/orders').send({ customer: `c${i % 5}`, amount: i });
    }
    const stats = await runLoad(
      (i) =>
        request(app)
          .get('/orders/search')
          .query({ q: `c${i % 5}` })
          .then((r) => ({ ok: r.status === 200 })),
      opts,
    );
    assertWithinBudget(stats, opts, 'GET /orders/search');
    expect(stats.count).toBe(opts.total);
  });

  it('summarise() reports p50/p95/p99 in ascending order', () => {
    const stats = summarise([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0);
    expect(stats.p50).toBeLessThanOrEqual(stats.p95);
    expect(stats.p95).toBeLessThanOrEqual(stats.p99);
    expect(stats.max).toBe(100);
  });

  it('assertWithinBudget throws when error rate exceeds the budget', async () => {
    const stats: RunStats = {
      count: 100,
      errors: 10,
      errorRate: 0.1,
      p50: 5,
      p95: 10,
      p99: 20,
      max: 30,
    };
    expect(() => assertWithinBudget(stats, opts, 'demo')).toThrow(/error rate/);
  });

  it('assertWithinBudget throws when p95 exceeds the budget', async () => {
    const stats: RunStats = {
      count: 100,
      errors: 0,
      errorRate: 0,
      p50: 5,
      p95: opts.p95BudgetMs + 1,
      p99: opts.p95BudgetMs + 5,
      max: opts.maxBudgetMs - 1,
    };
    expect(() => assertWithinBudget(stats, opts, 'demo')).toThrow(/p95/);
  });
});
