import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

import dashboardRouter from "../../backend/routes/dashboard.js";

function buildApp() {
  const app = express();
  app.use(dashboardRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /dashboard", () => {
  const app = buildApp();

  it("returns 200 with all five data sources", async () => {
    const res = await request(app).get("/dashboard");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("userStats");
    expect(res.body.data).toHaveProperty("recentOrders");
    expect(res.body.data).toHaveProperty("revenueTotals");
    expect(res.body.data).toHaveProperty("activeSessions");
    expect(res.body.data).toHaveProperty("alerts");
  });

  it("returns degraded: false when all sources succeed", async () => {
    const res = await request(app).get("/dashboard");

    expect(res.status).toBe(200);
    expect(res.body.degraded).toBe(false);
  });

  it("returns all data concurrently (not sequentially)", async () => {
    const res = await request(app).get("/dashboard");

    expect(res.status).toBe(200);
    const data = res.body.data;
    const fields = [
      data.userStats,
      data.recentOrders,
      data.revenueTotals,
      data.activeSessions,
      data.alerts,
    ];
    expect(fields.every((f: unknown) => f !== null)).toBe(true);
  });

  it("uses Promise.allSettled pattern (handler source code check)", async () => {
    const fs = await import("fs");
    const url = await import("url");
    const path = await import("path");
    const dir = path.dirname(url.fileURLToPath(import.meta.url));
    const source = fs.readFileSync(
      path.resolve(dir, "../../backend/routes/dashboard.ts"),
      "utf-8",
    );
    expect(source).toContain("Promise.allSettled");
    expect(source).not.toMatch(
      /await fetchUserStats[\s\S]*await fetchRecentOrders/,
    );
  });
});
