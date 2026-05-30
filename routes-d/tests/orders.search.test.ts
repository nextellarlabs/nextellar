// Tests for the order search endpoint (#300). Covers empty result,
// multi-filter, pagination, and validation rejection paths.

import express, { type Express } from "express";
import request from "supertest";
import { InMemoryOrderIndex } from "../lib/orderIndex.js";
import { createOrdersSearchRouter } from "../routes/orders.search.js";

function seed(): InMemoryOrderIndex {
  const idx = new InMemoryOrderIndex();
  const orders = [
    { id: "1", customer: "alice", status: "pending" as const, amount: 100, createdAt: 1000 },
    { id: "2", customer: "bob", status: "paid" as const, amount: 200, createdAt: 2000 },
    { id: "3", customer: "alice", status: "shipped" as const, amount: 50, createdAt: 3000 },
    { id: "4", customer: "carol", status: "delivered" as const, amount: 500, createdAt: 4000 },
    { id: "5", customer: "alice", status: "paid" as const, amount: 25, createdAt: 5000 },
    { id: "6", customer: "bob", status: "shipped" as const, amount: 75, createdAt: 6000 },
    { id: "7", customer: "carol", status: "pending" as const, amount: 600, createdAt: 7000 },
  ];
  for (const o of orders) idx.add(o);
  return idx;
}

function buildApp(idx: InMemoryOrderIndex): Express {
  const app = express();
  app.use(express.json());
  app.use("/orders", createOrdersSearchRouter({ index: idx }));
  return app;
}

describe("GET /orders/search", () => {
  it("returns empty results when nothing matches", async () => {
    const app = buildApp(seed());
    const res = await request(app).get("/orders/search").query({ q: "zzz" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, total: 0, results: [], hasNextPage: false });
  });

  it("filters by exact customer (q)", async () => {
    const app = buildApp(seed());
    const res = await request(app).get("/orders/search").query({ q: "alice" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.results.every((o: { customer: string }) => o.customer === "alice")).toBe(true);
  });

  it("combines q + status filters (multi-filter)", async () => {
    const app = buildApp(seed());
    const res = await request(app).get("/orders/search").query({ q: "alice", status: "paid" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.results[0]).toMatchObject({ id: "5", customer: "alice", status: "paid" });
  });

  it("filters by createdAt range (from + to)", async () => {
    const app = buildApp(seed());
    const res = await request(app).get("/orders/search").query({ from: 2000, to: 4000 });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.results.map((o: { id: string }) => o.id).sort()).toEqual(["2", "3", "4"]);
  });

  it("paginates: page=1 + pageSize=2 returns 2 results with hasNextPage", async () => {
    const app = buildApp(seed());
    const res = await request(app).get("/orders/search").query({ pageSize: 2, page: 1 });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.total).toBe(7);
    expect(res.body.hasNextPage).toBe(true);
  });

  it("paginates: last page reports hasNextPage=false", async () => {
    const app = buildApp(seed());
    const res = await request(app).get("/orders/search").query({ pageSize: 3, page: 3 });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.hasNextPage).toBe(false);
  });

  it("sorts ascending by amount when requested", async () => {
    const app = buildApp(seed());
    const res = await request(app).get("/orders/search").query({ sortBy: "amount", sortDir: "asc" });
    expect(res.status).toBe(200);
    const amounts = res.body.results.map((o: { amount: number }) => o.amount);
    const sorted = [...amounts].sort((a, b) => a - b);
    expect(amounts).toEqual(sorted);
  });

  it("rejects invalid status with 400", async () => {
    const app = buildApp(seed());
    const res = await request(app).get("/orders/search").query({ status: "exploded" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status must be/);
  });

  it("rejects from > to with 400", async () => {
    const app = buildApp(seed());
    const res = await request(app).get("/orders/search").query({ from: 5000, to: 2000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/from must be <= to/);
  });

  it("rejects non-integer page with 400", async () => {
    const app = buildApp(seed());
    const res = await request(app).get("/orders/search").query({ page: "0.5" });
    expect(res.status).toBe(400);
  });

  it("rejects negative epoch in from with 400", async () => {
    const app = buildApp(seed());
    const res = await request(app).get("/orders/search").query({ from: -1 });
    expect(res.status).toBe(400);
  });
});
