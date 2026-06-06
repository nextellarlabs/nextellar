// Orders-list hot-path benchmark (#314).
//
// Stands up an in-memory order index and measures end-to-end latency
// of the list-with-filters operation under realistic data volumes.
// Captures p50/p99 and (when `recordedAt` is provided) appends to the
// CSV ledger + fails on regression.

import { recordRun, summariseLatencies } from "./_recorder.js";

export interface OrdersListBenchOptions {
  /** Number of orders to seed the index with. Default 5000. */
  seed?: number;
  /** Number of `list` calls to measure. Default 500. */
  lookups?: number;
  outputPath?: string;
  p99BudgetMs?: number;
  maxBudgetMs?: number;
  recordedAt?: string;
}

type Status = "pending" | "paid" | "shipped" | "delivered" | "cancelled";

interface Order {
  id: string;
  customer: string;
  amount: number;
  status: Status;
  createdAt: number;
}

const STATUSES: Status[] = ["pending", "paid", "shipped", "delivered", "cancelled"];

function seedOrders(count: number): Order[] {
  const out: Order[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      id: `o-${i.toString(16)}`,
      customer: `customer-${i % 200}`,
      amount: 5 + (i % 900),
      status: STATUSES[i % STATUSES.length] as Status,
      createdAt: 1_700_000_000_000 + i * 1000,
    });
  }
  return out;
}

interface ListQuery {
  status?: Status;
  customer?: string;
  page: number;
  pageSize: number;
  sortBy: "createdAt" | "amount";
  sortDir: "asc" | "desc";
}

function listOrders(orders: Order[], query: ListQuery): Order[] {
  let filtered = orders;
  if (query.status) filtered = filtered.filter((o) => o.status === query.status);
  if (query.customer) filtered = filtered.filter((o) => o.customer === query.customer);
  const sorted = filtered.slice().sort((a, b) => {
    const lhs = query.sortBy === "amount" ? a.amount : a.createdAt;
    const rhs = query.sortBy === "amount" ? b.amount : b.createdAt;
    return query.sortDir === "asc" ? lhs - rhs : rhs - lhs;
  });
  const start = (query.page - 1) * query.pageSize;
  return sorted.slice(start, start + query.pageSize);
}

function nextQuery(i: number): ListQuery {
  return {
    status: i % 3 === 0 ? (STATUSES[i % STATUSES.length] as Status) : undefined,
    customer: i % 5 === 0 ? `customer-${i % 200}` : undefined,
    page: 1 + (i % 10),
    pageSize: 20,
    sortBy: i % 2 === 0 ? "createdAt" : "amount",
    sortDir: i % 2 === 0 ? "desc" : "asc",
  };
}

export interface OrdersListBenchResult {
  count: number;
  p50: number;
  p99: number;
  csvPath?: string;
}

export async function runOrdersListProfile(
  options: OrdersListBenchOptions = {},
): Promise<OrdersListBenchResult> {
  const seed = options.seed ?? 5000;
  const lookups = options.lookups ?? 500;
  const orders = seedOrders(seed);
  const samples: number[] = [];

  for (let i = 0; i < lookups; i += 1) {
    const q = nextQuery(i);
    const t0 = performance.now();
    listOrders(orders, q);
    samples.push(performance.now() - t0);
  }

  const stats = summariseLatencies(samples);

  if (options.recordedAt) {
    const recorded = await recordRun(
      samples,
      {
        profile: "orders.list",
        outputPath: options.outputPath,
        p99BudgetMs: options.p99BudgetMs,
        maxBudgetMs: options.maxBudgetMs,
      },
      options.recordedAt,
    );
    return { count: stats.count, p50: stats.p50, p99: stats.p99, csvPath: recorded.csvPath };
  }

  return { count: stats.count, p50: stats.p50, p99: stats.p99 };
}

if (process.argv[1]?.endsWith("orders-list-profile.ts")) {
  runOrdersListProfile({
    seed: Number(process.env.ROUTES_D_BENCH_SEED ?? 5000),
    lookups: Number(process.env.ROUTES_D_BENCH_LOOKUPS ?? 1000),
    recordedAt: new Date().toISOString(),
    p99BudgetMs: Number(process.env.ROUTES_D_BENCH_P99_MS ?? 250),
  }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
  });
}
