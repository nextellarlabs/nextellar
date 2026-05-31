// In-memory order search index (#300).
//
// Pluggable backing store for `orders.search.ts`. The interface is what
// the route consumes; the default `InMemoryOrderIndex` is what tests
// exercise. A production drop-in could implement the same interface
// against Postgres, Meilisearch, or whatever the team picks later.

export type OrderStatus =
  | "pending"
  | "paid"
  | "fulfilled"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export interface IndexedOrder {
  id: string;
  customer: string;
  status: OrderStatus;
  amount: number;
  createdAt: number;
}

export interface OrderSearchQuery {
  /** Free-text query matched against `customer` (case-insensitive). */
  q?: string;
  status?: OrderStatus;
  /** Inclusive lower bound on `createdAt` (epoch ms). */
  from?: number;
  /** Inclusive upper bound on `createdAt` (epoch ms). */
  to?: number;
  /** Page number, 1-indexed. Default 1. */
  page?: number;
  /** Page size. Default 20, max 100. */
  pageSize?: number;
  /** Sort key. Default `createdAt`. */
  sortBy?: "createdAt" | "amount" | "customer";
  /** Sort direction. Default `desc`. */
  sortDir?: "asc" | "desc";
}

export interface SearchResultPage {
  results: IndexedOrder[];
  total: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

export interface OrderIndex {
  add(order: IndexedOrder): void;
  search(query: OrderSearchQuery): SearchResultPage;
  size(): number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function compareOrders(
  a: IndexedOrder,
  b: IndexedOrder,
  sortBy: NonNullable<OrderSearchQuery["sortBy"]>,
  sortDir: NonNullable<OrderSearchQuery["sortDir"]>,
): number {
  let cmp = 0;
  if (sortBy === "amount") cmp = a.amount - b.amount;
  else if (sortBy === "customer") cmp = a.customer.localeCompare(b.customer);
  else cmp = a.createdAt - b.createdAt;
  return sortDir === "asc" ? cmp : -cmp;
}

export class InMemoryOrderIndex implements OrderIndex {
  private readonly byId = new Map<string, IndexedOrder>();
  // Lower-cased customer → set of ids. Speeds up the common "exact
  // customer match" path; falls back to a substring scan if the query
  // does not match an exact bucket.
  private readonly byCustomer = new Map<string, Set<string>>();

  add(order: IndexedOrder): void {
    this.byId.set(order.id, order);
    const key = order.customer.toLowerCase();
    const bucket = this.byCustomer.get(key) ?? new Set<string>();
    bucket.add(order.id);
    this.byCustomer.set(key, bucket);
  }

  size(): number {
    return this.byId.size;
  }

  search(query: OrderSearchQuery): SearchResultPage {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));
    const sortBy = query.sortBy ?? "createdAt";
    const sortDir = query.sortDir ?? "desc";
    const q = query.q?.toLowerCase().trim();

    let candidates: Iterable<IndexedOrder>;
    if (q && this.byCustomer.has(q)) {
      // Exact-customer fast path.
      const ids = this.byCustomer.get(q) ?? new Set<string>();
      candidates = Array.from(ids, (id) => this.byId.get(id)).filter(
        (x): x is IndexedOrder => x !== undefined,
      );
    } else {
      candidates = this.byId.values();
    }

    const matches: IndexedOrder[] = [];
    for (const order of candidates) {
      if (q && !order.customer.toLowerCase().includes(q)) continue;
      if (query.status && order.status !== query.status) continue;
      if (query.from !== undefined && order.createdAt < query.from) continue;
      if (query.to !== undefined && order.createdAt > query.to) continue;
      matches.push(order);
    }

    matches.sort((a, b) => compareOrders(a, b, sortBy, sortDir));

    const total = matches.length;
    const start = (page - 1) * pageSize;
    const slice = matches.slice(start, start + pageSize);
    return {
      results: slice,
      total,
      page,
      pageSize,
      hasNextPage: start + pageSize < total,
    };
  }
}
