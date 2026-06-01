// Tests for the CSV export endpoint (#301).
// Covers small export, large export, and access denial.

import express, { type Express, type Request } from "express";
import request from "supertest";
import { InMemoryOrderIndex } from "../lib/orderIndex.js";
import { createOrdersExportRouter } from "../routes/orders.export.js";

function seed(count: number): InMemoryOrderIndex {
  const idx = new InMemoryOrderIndex();
  const statuses = ["pending", "paid", "fulfilled", "shipped", "delivered", "cancelled", "refunded"] as const;
  for (let i = 0; i < count; i++) {
    idx.add({
      id: `order-${i + 1}`,
      customer: `customer-${i % 10}`,
      status: statuses[i % statuses.length],
      amount: (i + 1) * 10,
      createdAt: 1_000_000 + i * 1000,
    });
  }
  return idx;
}

function buildApp(idx: InMemoryOrderIndex, guard?: (req: Request) => boolean): Express {
  const app = express();
  app.use(express.json());
  app.use("/orders", createOrdersExportRouter({ index: idx, guard }));
  return app;
}

describe("GET /orders/export (#301)", () => {
  it("streams a small export as CSV with correct headers", async () => {
    const app = buildApp(seed(3));
    const res = await request(app).get("/orders/export");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    const lines = res.text.trim().split("\n");
    // header + 3 data rows
    expect(lines[0]).toBe("id,customer,status,amount,createdAt");
    expect(lines).toHaveLength(4);
  });

  it("streams a large export (200 rows) without buffering issues", async () => {
    const app = buildApp(seed(200));
    const res = await request(app).get("/orders/export");
    expect(res.status).toBe(200);
    const lines = res.text.trim().split("\n");
    expect(lines).toHaveLength(201); // header + 200 rows
  });

  it("filters by status", async () => {
    const app = buildApp(seed(14));
    const res = await request(app).get("/orders/export").query({ status: "pending" });
    expect(res.status).toBe(200);
    const [header, ...rows] = res.text.trim().split("\n");
    expect(header).toBe("id,customer,status,amount,createdAt");
    for (const row of rows) {
      expect(row).toContain("pending");
    }
  });

  it("filters by date range (from/to)", async () => {
    const app = buildApp(seed(10));
    // createdAt for index 2 = 1_002_000, index 4 = 1_004_000
    const res = await request(app)
      .get("/orders/export")
      .query({ from: 1_002_000, to: 1_004_000 });
    expect(res.status).toBe(200);
    const lines = res.text.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2); // header + at least 1 row
  });

  it("returns 403 when the guard denies access", async () => {
    const app = buildApp(seed(5), () => false);
    const res = await request(app).get("/orders/export");
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
  });

  it("returns 400 for an invalid status value", async () => {
    const app = buildApp(seed(3));
    const res = await request(app).get("/orders/export").query({ status: "exploded" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status must be/);
  });

  it("returns 400 when from > to", async () => {
    const app = buildApp(seed(3));
    const res = await request(app).get("/orders/export").query({ from: 9000, to: 1000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/from must be <= to/);
  });

  it("returns an empty CSV (header only) when no orders match", async () => {
    const app = buildApp(seed(5));
    const res = await request(app).get("/orders/export").query({ q: "nobody" });
    expect(res.status).toBe(200);
    expect(res.text.trim()).toBe("id,customer,status,amount,createdAt");
  });
});
