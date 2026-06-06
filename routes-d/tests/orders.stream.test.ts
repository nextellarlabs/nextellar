import express, { type Express } from "express";
import request from "supertest";
import { InMemoryOrderIndex } from "../lib/orderIndex.js";
import { createOrdersExportRouter } from "../routes/orders.export.js";
import { createOrdersSearchRouter } from "../routes/orders.search.js";

function seed(): InMemoryOrderIndex {
  const idx = new InMemoryOrderIndex();
  for (let i = 0; i < 50; i += 1) {
    idx.add({
      id: String(i + 1),
      customer: i % 2 === 0 ? "alice" : "bob",
      status: "pending",
      amount: i + 1,
      createdAt: 1000 + i,
    });
  }
  return idx;
}

function buildExportApp(idx: InMemoryOrderIndex): Express {
  const app = express();
  app.use("/orders", createOrdersExportRouter({ index: idx }));
  return app;
}

function buildSearchApp(idx: InMemoryOrderIndex): Express {
  const app = express();
  app.use("/orders", createOrdersSearchRouter({ index: idx }));
  return app;
}

describe("orders export/search streaming", () => {
  it("exports orders as a streamed JSON array", async () => {
    const idx = seed();
    const res = await request(buildExportApp(idx)).get("/orders/export").query({ q: "alice" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    const parsed = JSON.parse(res.text) as Array<{ customer: string }>;
    expect(parsed.length).toBe(25);
    expect(parsed.every((order) => order.customer === "alice")).toBe(true);
  });

  it("streams search results when stream=true", async () => {
    const idx = seed();
    const res = await request(buildSearchApp(idx)).get("/orders/search").query({ q: "bob", stream: "true" });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.text) as Array<{ customer: string }>;
    expect(parsed.length).toBe(25);
    expect(parsed.every((order) => order.customer === "bob")).toBe(true);
  });
});
