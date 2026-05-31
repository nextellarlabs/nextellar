import express, { type Express } from "express";
import request from "supertest";
import { Roles } from "../auth/roles.js";
import { AnalyticsCache } from "../lib/paymentAnalytics.js";
import { createPaymentsAnalyticsRouter } from "../routes/payments.analytics.js";

const DAY = 86_400_000;
const BASE = Date.parse("2026-05-30T12:00:00Z");

function buildApp(
  records: Array<{ id: string; amount: number; currency: string; createdAt: number }>,
  role: unknown,
  cache = new AnalyticsCache(60_000),
) {
  const app = express();
  app.use((req, _res, next) => {
    if (role !== undefined) {
      (req as express.Request & { user?: { role: unknown } }).user = { role };
    }
    next();
  });
  app.use(
    "/payments",
    createPaymentsAnalyticsRouter({
      store: {
        async listBetween(fromMs, toMs) {
          return records.filter((r) => r.createdAt >= fromMs && r.createdAt < toMs);
        },
      },
      cache,
      now: () => BASE + DAY,
    }),
  );
  return app;
}

describe("GET /payments/analytics", () => {
  it("returns empty buckets for an empty window", async () => {
    const app = buildApp([], Roles.Admin);
    const from = new Date(BASE - 2 * DAY).toISOString();
    const to = new Date(BASE).toISOString();
    const res = await request(app).get(`/payments/analytics?window=daily&from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    expect(res.body.cacheHit).toBe(false);
    expect(res.body.analytics.buckets).toEqual([]);
  });

  it("aggregates a partial daily window", async () => {
    const app = buildApp(
      [
        { id: "p1", amount: 10, currency: "USD", createdAt: BASE - DAY / 2 },
        { id: "p2", amount: 5, currency: "USD", createdAt: BASE - DAY / 4 },
      ],
      Roles.Admin,
    );
    const from = new Date(BASE - DAY).toISOString();
    const to = new Date(BASE + DAY).toISOString();
    const res = await request(app).get(`/payments/analytics?window=daily&from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    expect(res.body.analytics.buckets.length).toBeGreaterThan(0);
    expect(res.body.analytics.buckets[0].count).toBe(2);
    expect(res.body.analytics.buckets[0].totalAmount).toBe(15);
  });

  it("returns cacheHit on the second identical request", async () => {
    const cache = new AnalyticsCache(60_000);
    const app = buildApp(
      [{ id: "p1", amount: 1, currency: "USD", createdAt: BASE - 1000 }],
      Roles.Admin,
      cache,
    );
    const qs = `/payments/analytics?window=weekly&from=${new Date(BASE - 7 * DAY).toISOString()}&to=${new Date(BASE).toISOString()}`;
    const first = await request(app).get(qs);
    const second = await request(app).get(qs);
    expect(first.body.cacheHit).toBe(false);
    expect(second.body.cacheHit).toBe(true);
    expect(second.body.analytics).toEqual(first.body.analytics);
  });

  it("returns 403 for non-admin callers", async () => {
    const app = buildApp([], Roles.User);
    const res = await request(app).get("/payments/analytics?window=daily");
    expect(res.status).toBe(403);
  });
});
