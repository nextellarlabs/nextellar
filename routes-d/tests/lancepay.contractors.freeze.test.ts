import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedContractor,
  __getContractor,
  __getAuditLog,
  __resetContractors,
} from "../routes/lancepay.contractors.freeze.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const ACTIVE_CONTRACTOR = {
  id: "con-1",
  workspaceId: "ws-1",
  status: "active" as const,
  updatedAt: new Date().toISOString(),
};

const FROZEN_CONTRACTOR = {
  id: "con-2",
  workspaceId: "ws-1",
  status: "frozen" as const,
  frozenAt: new Date().toISOString(),
  frozenBy: "admin-1",
  updatedAt: new Date().toISOString(),
};

describe("POST /lancepay/contractors/:id/freeze", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetContractors();
    __seedContractor(ACTIVE_CONTRACTOR);
    __seedContractor(FROZEN_CONTRACTOR);
  });

  it("freezes an active contractor and returns 200", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/freeze")
      .send({ adminId: "admin-1", reason: "Suspicious activity" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("frozen");
    expect(res.body.data.frozenBy).toBe("admin-1");
  });

  it("persists freeze in storage", async () => {
    await request(app)
      .post("/lancepay/contractors/con-1/freeze")
      .send({ adminId: "admin-1" });
    const stored = __getContractor("con-1")!;
    expect(stored.status).toBe("frozen");
    expect(stored.frozenAt).toBeDefined();
  });

  it("emits an audit event on freeze", async () => {
    await request(app)
      .post("/lancepay/contractors/con-1/freeze")
      .send({ adminId: "admin-1", reason: "Review" });
    const log = __getAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe("freeze");
    expect(log[0].performedBy).toBe("admin-1");
  });

  it("returns 409 when contractor is already frozen", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-2/freeze")
      .send({ adminId: "admin-1" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_FROZEN");
  });

  it("returns 403 when adminId is missing", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/freeze")
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("accepts adminId from x-admin-id header", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/con-1/freeze")
      .set("x-admin-id", "admin-from-header")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.frozenBy).toBe("admin-from-header");
  });

  it("returns 404 for unknown contractor", async () => {
    const res = await request(app)
      .post("/lancepay/contractors/nonexistent/freeze")
      .send({ adminId: "admin-1" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
