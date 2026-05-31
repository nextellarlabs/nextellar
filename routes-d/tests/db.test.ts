import express, { type Express } from "express";
import request from "supertest";
import { DbPool, getDbPool, renderDbPoolMetrics, resetDbPool } from "../lib/db.js";
import metricsRouter from "../routes/metrics.js";
import { createStatusRouter } from "../routes/health.status.js";
import { resetMetrics } from "../lib/metrics.js";

afterEach(async () => {
  await resetDbPool();
});

describe("DbPool", () => {
  it("acquires and releases connections", async () => {
    const pool = new DbPool({ min: 1, max: 2, idleTimeoutMs: 1_000 });
    await pool.warm();
    const conn = await pool.acquire();
    expect(conn.id).toBeDefined();
    expect(pool.metrics().active).toBe(1);
    pool.release(conn);
    expect(pool.metrics().idle).toBeGreaterThanOrEqual(1);
    await pool.shutdown();
  });

  it("times out when the pool is exhausted", async () => {
    const pool = new DbPool({ min: 0, max: 1, connectTimeoutMs: 20 });
    const conn = await pool.acquire();
    await expect(pool.acquire()).rejects.toThrow("acquire timeout");
    pool.release(conn);
    await pool.shutdown();
  });

  it("reports health via ping", async () => {
    const pool = new DbPool({ min: 1, max: 2 });
    await pool.warm();
    const health = await pool.health();
    expect(health.ok).toBe(true);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    await pool.shutdown();
  });

  it("exposes pool metrics for Prometheus", async () => {
    const pool = new DbPool({ min: 1, max: 3 });
    await pool.warm();
    const conn = await pool.acquire();
    const metricsText = renderDbPoolMetrics();
    expect(metricsText).toContain("nextellar_db_pool_total");
    expect(metricsText).toContain("nextellar_db_pool_active");
    pool.release(conn);
    await pool.shutdown();
  });
});

function buildStatusApp(pool: DbPool): Express {
  const app = express();
  app.use(createStatusRouter({ pool }));
  return app;
}

function buildMetricsApp(): Express {
  const app = express();
  app.set("trust proxy", true);
  app.use(metricsRouter);
  return app;
}

describe("status and metrics integration", () => {
  it("returns db health on /status", async () => {
    const pool = new DbPool({ min: 1, max: 2 });
    await pool.warm();
    const res = await request(buildStatusApp(pool)).get("/status");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.db.pool.total).toBeGreaterThanOrEqual(1);
    await pool.shutdown();
  });

  it("includes db pool metrics on /metrics", async () => {
    resetMetrics();
    const pool = getDbPool({ min: 1, max: 2 });
    await pool.warm();
    const res = await request(buildMetricsApp())
      .get("/metrics")
      .set("X-Forwarded-For", "127.0.0.1");
    expect(res.status).toBe(200);
    expect(res.text).toContain("nextellar_db_pool_total");
    await resetDbPool();
  });
});
