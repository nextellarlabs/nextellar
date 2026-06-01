import { decodeCursor, encodeCursor, type CursorSortKey } from "./pagination.js";
import type { IndexedOrder, OrderSearchQuery, OrderStatus } from "./orderIndex.js";

export interface OrderListQuery {
  status?: OrderStatus;
  customer?: string;
  from?: number;
  to?: number;
  sortBy?: NonNullable<OrderSearchQuery["sortBy"]>;
  sortDir?: NonNullable<OrderSearchQuery["sortDir"]>;
  limit?: number;
  cursor?: string;
  cursorSecret?: string;
}

export interface OrderListPage {
  results: IndexedOrder[];
  pagination: {
    limit: number;
    nextCursor?: string;
    hasMore: boolean;
  };
}

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

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
  if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
  return a.id.localeCompare(b.id);
}

function sortValue(order: IndexedOrder, sortBy: NonNullable<OrderSearchQuery["sortBy"]>): CursorSortKey["value"] {
  if (sortBy === "amount") return order.amount;
  if (sortBy === "customer") return order.customer;
  return order.createdAt;
}

function cursorAnchor(keys: CursorSortKey[]): IndexedOrder {
  const anchor: IndexedOrder = {
    id: "",
    customer: "",
    amount: 0,
    createdAt: 0,
    status: "pending",
  };
  for (const key of keys) {
    if (key.field === "id") anchor.id = String(key.value);
    if (key.field === "customer") anchor.customer = String(key.value);
    if (key.field === "amount") anchor.amount = Number(key.value);
    if (key.field === "createdAt") anchor.createdAt = Number(key.value);
  }
  return anchor;
}

function isAfterCursor(
  order: IndexedOrder,
  keys: CursorSortKey[],
  sortBy: NonNullable<OrderSearchQuery["sortBy"]>,
  sortDir: NonNullable<OrderSearchQuery["sortDir"]>,
): boolean {
  return compareOrders(order, cursorAnchor(keys), sortBy, sortDir) > 0;
}

export function listOrdersWithCursor(orders: IndexedOrder[], query: OrderListQuery): OrderListPage {
  const sortBy = query.sortBy ?? "createdAt";
  const sortDir = query.sortDir ?? "desc";
  const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, query.limit ?? DEFAULT_LIST_LIMIT));
  const customer = query.customer?.toLowerCase().trim();

  let matches = orders.filter((order) => {
    if (query.status && order.status !== query.status) return false;
    if (customer && !order.customer.toLowerCase().includes(customer)) return false;
    if (query.from !== undefined && order.createdAt < query.from) return false;
    if (query.to !== undefined && order.createdAt > query.to) return false;
    return true;
  });

  matches.sort((a, b) => compareOrders(a, b, sortBy, sortDir));

  if (query.cursor) {
    const payload = decodeCursor(query.cursor, { secret: query.cursorSecret });
    matches = matches.filter((order) => isAfterCursor(order, payload.sort, sortBy, sortDir));
  }

  const slice = matches.slice(0, limit);
  const hasMore = matches.length > limit;
  const last = slice.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeCursor(
          [
            { field: sortBy, direction: sortDir, value: sortValue(last, sortBy) },
            { field: "id", direction: "asc", value: last.id },
          ],
          { secret: query.cursorSecret },
        )
      : undefined;

  return {
    results: slice,
    pagination: {
      limit,
      nextCursor,
      hasMore,
    },
  };
}
