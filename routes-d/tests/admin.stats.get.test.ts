import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __setStatsStore,
  __resetStats,
  __expireCache,
} from "../routes/admin.stats.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /admin/stats", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetStats();
  });

  it("returns aggregate platform stats for an authorized operator", async () => {
    __setStatsStore({
      activeUsers: 42,
      paymentVolumeUsd: 100_000,
      webhookDeliveriesTotal: 200,
      webhookDeliveriesSuccess: 190,
    });

    const res = await request(app)
      .get("/admin/stats")
      .set("x-operator-id", "op-1");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.activeUsers).toBe(42);
    expect(res.body.data.paymentVolumeUsd).toBe(100_000);
    expect(res.body.data.webhookHealthPercent).toBe(95);
    expect(res.body.data.cachedAt).toBeDefined();
  });

  it("returns 100% webhook health when there are no deliveries", async () => {
    __setStatsStore({ activeUsers: 5, paymentVolumeUsd: 0 });

    const res = await request(app)
      .get("/admin/stats")
      .set("x-operator-id", "op-1");

    expect(res.status).toBe(200);
    expect(res.body.data.webhookHealthPercent).toBe(100);
  });

  it("returns zeroed stats when underlying data is empty", async () => {
    const res = await request(app)
      .get("/admin/stats")
      .set("x-operator-id", "op-1");

    expect(res.status).toBe(200);
    expect(res.body.data.activeUsers).toBe(0);
    expect(res.body.data.paymentVolumeUsd).toBe(0);
    expect(res.body.data.webhookHealthPercent).toBe(100);
  });

  it("serves cached stats without recomputing within the TTL", async () => {
    __setStatsStore({ activeUsers: 10 });

    const res1 = await request(app)
      .get("/admin/stats")
      .set("x-operator-id", "op-1");
    const cachedAt1 = res1.body.data.cachedAt;

    // Update the underlying data without expiring the cache
    __setStatsStore({ activeUsers: 99 });
    // Re-seed without expiring cache so the cached value persists
    // (use __expireCache to bypass for the next assertion)

    const res2 = await request(app)
      .get("/admin/stats")
      .set("x-operator-id", "op-1");

    // After __setStatsStore the cache was cleared, so a new value is returned
    expect(res2.body.data.activeUsers).toBe(99);

    // Verify cache is served on a second call without changes
    const res3 = await request(app)
      .get("/admin/stats")
      .set("x-operator-id", "op-1");
    expect(res3.body.data.cachedAt).toBe(res2.body.data.cachedAt);
  });

  it("recomputes stats after the cache is expired", async () => {
    __setStatsStore({ activeUsers: 10 });
    await request(app).get("/admin/stats").set("x-operator-id", "op-1");

    __expireCache();
    __setStatsStore({ activeUsers: 55 });

    const res = await request(app)
      .get("/admin/stats")
      .set("x-operator-id", "op-1");

    expect(res.body.data.activeUsers).toBe(55);
  });

  it("returns 401 when operator identity is missing", async () => {
    const res = await request(app).get("/admin/stats");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
