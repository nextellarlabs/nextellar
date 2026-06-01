import express, { type Express } from "express";
import request from "supertest";
import { InMemoryOrderIndex } from "../lib/orderIndex.js";
import { createOrdersListRouter } from "../routes/orders.list.js";

const CURSOR_SECRET = "test-cursor-secret-value";

function seed(): InMemoryOrderIndex {
  const idx = new InMemoryOrderIndex();
  const orders = [
    { id: "1", customer: "alice", status: "pending" as const, amount: 100, createdAt: 1000 },
    { id: "2", customer: "bob", status: "paid" as const, amount: 200, createdAt: 2000 },
    { id: "3", customer: "alice", status: "shipped" as const, amount: 50, createdAt: 3000 },
    { id: "4", customer: "carol", status: "delivered" as const, amount: 500, createdAt: 4000 },
    { id: "5", customer: "alice", status: "paid" as const, amount: 25, createdAt: 5000 },
  ];
  for (const o of orders) idx.add(o);
  return idx;
}

function buildApp(idx: InMemoryOrderIndex): Express {
  const app = express();
  app.use(express.json());
  app.use("/orders", createOrdersListRouter({ index: idx, cursorSecret: CURSOR_SECRET }));
  return app;
}

describe("GET /orders/list", () => {
  it("returns the first page with a default limit", async () => {
    const app = buildApp(seed());
    const res = await request(app).get("/orders/list").query({ limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({ limit: 2, hasMore: true });
    expect(res.body.pagination.nextCursor).toBeTruthy();
  });

  it("returns a subsequent page when a valid cursor is supplied", async () => {
    const app = buildApp(seed());
    const first = await request(app).get("/orders/list").query({ limit: 2 });
    const second = await request(app)
      .get("/orders/list")
      .query({ limit: 2, cursor: first.body.pagination.nextCursor });

    expect(second.status).toBe(200);
    expect(second.body.results).toHaveLength(2);
    expect(first.body.results[0].id).not.toBe(second.body.results[0].id);
  });

  it("rejects an invalid cursor with 400", async () => {
    const app = buildApp(seed());
    const res = await request(app).get("/orders/list").query({ cursor: "not-a-valid-cursor" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cursor|Invalid/i);
  });

  it("rejects invalid status with 400", async () => {
    const app = buildApp(seed());
    const res = await request(app).get("/orders/list").query({ status: "exploded" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status must be/);
  });

  it("caps limit at the configured maximum", async () => {
    const app = buildApp(seed());
    const res = await request(app).get("/orders/list").query({ limit: 500 });

    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(100);
  });
});
