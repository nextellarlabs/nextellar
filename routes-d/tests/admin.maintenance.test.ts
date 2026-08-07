import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import router, { __resetMaintenanceState } from "../routes/admin.maintenance.js";
import { maintenanceMiddleware } from "../middleware/maintenance.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(maintenanceMiddleware);
  app.use(router);
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });
  app.get("/api/status", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /admin/maintenance", () => {
  beforeEach(() => {
    __resetMaintenanceState();
  });

  it("toggles maintenance mode and allows whitelisted routes", async () => {
    const app = buildApp();

    const enableRes = await request(app).post("/admin/maintenance").send({
      enabled: true,
      allowlist: ["/health"],
      retryAfterSeconds: 60,
    });

    expect(enableRes.status).toBe(200);
    expect(enableRes.body.data.enabled).toBe(true);
    expect(enableRes.body.data.allowlist).toEqual(["/health"]);

    const healthRes = await request(app).get("/health");
    expect(healthRes.status).toBe(200);

    const blockedRes = await request(app).get("/api/status");
    expect(blockedRes.status).toBe(503);
    expect(blockedRes.headers["retry-after"]).toBe("60");
  });

  it("disables maintenance mode when requested", async () => {
    const app = buildApp();

    await request(app).post("/admin/maintenance").send({
      enabled: true,
      allowlist: [],
      retryAfterSeconds: 30,
    });

    const disableRes = await request(app).post("/admin/maintenance").send({
      enabled: false,
      allowlist: [],
      retryAfterSeconds: 30,
    });

    expect(disableRes.status).toBe(200);
    const healthyRes = await request(app).get("/api/status");
    expect(healthyRes.status).toBe(200);
  });
});
