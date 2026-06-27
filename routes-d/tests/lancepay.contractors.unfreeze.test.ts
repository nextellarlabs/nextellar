import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, { __seedContractor, __getContractor, __getAuditLog, __resetContractors } from "../routes/lancepay.contractors.unfreeze.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /lancepay/contractors/:id/unfreeze", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetContractors();
  });

  it("unfreezes a frozen contractor and emits audit log", async () => {
    __seedContractor({ id: "c1", workspaceId: "ws1", status: "frozen", updatedAt: "2026-01-01T00:00:00Z" });

    const res = await request(app).post("/lancepay/contractors/c1/unfreeze").send({ adminId: "admin1", reason: "Issue resolved" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("active");

    const contractor = __getContractor("c1");
    expect(contractor?.status).toBe("active");

    const logs = __getAuditLog();
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe("unfreeze");
    expect(logs[0].performedBy).toBe("admin1");
  });

  it("rejects when the contractor is not currently frozen", async () => {
    __seedContractor({ id: "c1", workspaceId: "ws1", status: "active", updatedAt: "2026-01-01T00:00:00Z" });

    const res = await request(app).post("/lancepay/contractors/c1/unfreeze").send({ adminId: "admin1" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NOT_FROZEN");

    const logs = __getAuditLog();
    expect(logs.length).toBe(0);
  });

  it("rejects unauthorized caller (no adminId)", async () => {
    __seedContractor({ id: "c1", workspaceId: "ws1", status: "frozen", updatedAt: "2026-01-01T00:00:00Z" });

    const res = await request(app).post("/lancepay/contractors/c1/unfreeze").send({});

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
