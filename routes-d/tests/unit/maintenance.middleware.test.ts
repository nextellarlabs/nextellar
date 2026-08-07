import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import { maintenanceMiddleware, __resetMaintenanceState } from "../../middleware/maintenance.js";
import adminMaintenanceRouter from "../../routes/admin.maintenance.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(maintenanceMiddleware);
  app.use(adminMaintenanceRouter);
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

describe("maintenance middleware", () => {
  beforeEach(() => {
    __resetMaintenanceState();
  });

  it("blocks non-allowlisted routes with 503 and a Retry-After header", async () => {
    const app = buildApp();

    const res = await request(app).get("/api/status");

    expect(res.status).toBe(200);

    const enabledRes = await request(app).post("/admin/maintenance").send({
      enabled: true,
      allowlist: ["/health"],
      retryAfterSeconds: 120,
    });

    expect(enabledRes.status).toBe(200);

    const blockedRes = await request(app).get("/api/status");
    expect(blockedRes.status).toBe(503);
    expect(blockedRes.headers["retry-after"]).toBe("120");
    expect(blockedRes.body.error.code).toBe("MAINTENANCE_MODE");
  });
});
