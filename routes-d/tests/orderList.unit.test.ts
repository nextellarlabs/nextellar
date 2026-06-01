import { listOrdersWithCursor } from "../lib/orderList.js";
import type { IndexedOrder } from "../lib/orderIndex.js";

const orders: IndexedOrder[] = [
  { id: "a", customer: "alice", status: "paid", amount: 10, createdAt: 3000 },
  { id: "b", customer: "bob", status: "paid", amount: 20, createdAt: 2000 },
  { id: "c", customer: "carol", status: "pending", amount: 30, createdAt: 1000 },
];

describe("listOrdersWithCursor", () => {
  it("filters by status and returns a next cursor", () => {
    const page = listOrdersWithCursor(orders, {
      status: "paid",
      limit: 1,
      cursorSecret: "test-cursor-secret-value",
    });

    expect(page.results).toHaveLength(1);
    expect(page.pagination.hasMore).toBe(true);
    expect(page.pagination.nextCursor).toBeTruthy();
  });
});
