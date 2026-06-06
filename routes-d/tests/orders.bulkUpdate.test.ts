// Tests for the bulk order status update endpoint (#303).
//
// Covers all-success, mixed result (some succeed, some fail with
// distinct reasons), total failure, envelope validation, and the
// per-item state-machine gate.

import express, { type Express } from "express";
import request from "supertest";
import type { OrderStatus } from "../lib/orderStateMachine.js";
import {
  type BulkOrderRecord,
  type BulkOrderStore,
  applyBulkItem,
  createOrdersBulkUpdateRouter,
} from "../routes/orders.bulkUpdate.js";

function buildStore(initial: BulkOrderRecord[] = []): BulkOrderStore & {
  inspect(): Map<string, BulkOrderRecord>;
} {
  const map = new Map<string, BulkOrderRecord>(initial.map((o) => [o.id, o]));
  return {
    async get(id) {
      return map.get(id);
    },
    async save(order) {
      map.set(order.id, order);
    },
    inspect: () => map,
  };
}

function buildApp(store: BulkOrderStore, maxItems?: number): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/orders",
    createOrdersBulkUpdateRouter({ store, now: () => 9000, maxItems }),
  );
  return app;
}

const seed: BulkOrderRecord[] = [
  { id: "o1", status: "pending", updatedAt: 0 },
  { id: "o2", status: "paid", updatedAt: 0 },
  { id: "o3", status: "fulfilled", updatedAt: 0 },
  { id: "o4", status: "cancelled", updatedAt: 0 }, // terminal
];

describe("applyBulkItem (pure)", () => {
  it("succeeds on a legal transition and persists the update", async () => {
    const store = buildStore([{ id: "o1", status: "pending", updatedAt: 0 }]);
    const result = await applyBulkItem(
      { orderId: "o1", status: "paid" as OrderStatus },
      store,
      () => 1234,
    );
    expect(result).toEqual({ orderId: "o1", ok: true, status: "paid" });
    expect(store.inspect().get("o1")).toEqual({ id: "o1", status: "paid", updatedAt: 1234 });
  });

  it("returns not-found error without throwing", async () => {
    const store = buildStore();
    const result = await applyBulkItem(
      { orderId: "ghost", status: "paid" as OrderStatus },
      store,
      () => 0,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it("returns from/to on illegal transitions", async () => {
    const store = buildStore([{ id: "o4", status: "cancelled", updatedAt: 0 }]);
    const result = await applyBulkItem(
      { orderId: "o4", status: "paid" as OrderStatus },
      store,
      () => 0,
    );
    expect(result.ok).toBe(false);
    expect(result.from).toBe("cancelled");
    expect(result.to).toBe("paid");
  });
});

describe("POST /orders/bulk-status", () => {
  it("returns ok=true for every item on an all-success batch", async () => {
    const store = buildStore(seed);
    const res = await request(buildApp(store))
      .post("/orders/bulk-status")
      .send({
        items: [
          { orderId: "o1", status: "paid" },
          { orderId: "o2", status: "fulfilled" },
          { orderId: "o3", status: "shipped" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      total: 3,
      succeeded: 3,
      failed: 0,
    });
    expect(res.body.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
    expect(store.inspect().get("o1")?.status).toBe("paid");
    expect(store.inspect().get("o2")?.status).toBe("fulfilled");
    expect(store.inspect().get("o3")?.status).toBe("shipped");
  });

  it("returns a mixed result: per-item ok/error without 4xx-ing the batch", async () => {
    const store = buildStore(seed);
    const res = await request(buildApp(store))
      .post("/orders/bulk-status")
      .send({
        items: [
          { orderId: "o1", status: "paid" }, // legal
          { orderId: "ghost", status: "paid" }, // not found
          { orderId: "o4", status: "paid" }, // illegal (terminal)
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.succeeded).toBe(1);
    expect(res.body.failed).toBe(2);

    const byId: Record<string, { ok: boolean; error?: string }> = {};
    for (const r of res.body.results as Array<{ orderId: string; ok: boolean; error?: string }>) {
      byId[r.orderId] = r;
    }
    expect(byId["o1"].ok).toBe(true);
    expect(byId["ghost"]).toMatchObject({ ok: false, error: expect.stringMatching(/not found/) });
    expect(byId["o4"]).toMatchObject({ ok: false, error: expect.stringMatching(/terminal/) });

    // The successful update must persist; the failed ones must not.
    expect(store.inspect().get("o1")?.status).toBe("paid");
    expect(store.inspect().get("o4")?.status).toBe("cancelled");
  });

  it("returns total failure as per-item errors (still 200)", async () => {
    const store = buildStore(seed);
    const res = await request(buildApp(store))
      .post("/orders/bulk-status")
      .send({
        items: [
          { orderId: "o4", status: "paid" },
          { orderId: "ghost-1", status: "paid" },
          { orderId: "ghost-2", status: "paid" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toBe(0);
    expect(res.body.failed).toBe(3);
    expect(res.body.results.every((r: { ok: boolean }) => r.ok === false)).toBe(true);
  });

  it("400s on a missing items field", async () => {
    const res = await request(buildApp(buildStore(seed)))
      .post("/orders/bulk-status")
      .send({});
    expect(res.status).toBe(400);
  });

  it("400s on an empty items array", async () => {
    const res = await request(buildApp(buildStore(seed)))
      .post("/orders/bulk-status")
      .send({ items: [] });
    expect(res.status).toBe(400);
  });

  it("400s when an item status is not a known OrderStatus", async () => {
    const res = await request(buildApp(buildStore(seed)))
      .post("/orders/bulk-status")
      .send({ items: [{ orderId: "o1", status: "exploded" }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/OrderStatus/);
  });

  it("400s when items exceeds maxItems", async () => {
    const items = Array.from({ length: 3 }, (_, i) => ({
      orderId: `o${i + 1}`,
      status: "paid" as OrderStatus,
    }));
    const res = await request(buildApp(buildStore(seed), 2))
      .post("/orders/bulk-status")
      .send({ items });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds maximum/);
  });
});
