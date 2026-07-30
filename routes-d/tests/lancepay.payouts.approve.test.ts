import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, { __seedPayout, __getPayout, __resetPayouts } from "../routes/lancepay.payouts.approve.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /lancepay/payouts/:id/approve", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetPayouts();
  });

  it("records first approval", async () => {
    __seedPayout({ id: "p1", workspaceId: "ws1", status: "pending", approvers: [], requiredApprovals: 2 });

    const res = await request(app).post("/lancepay/payouts/p1/approve").send({ adminId: "admin1" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.approvals).toBe(1);
    expect(res.body.data.status).toBe("pending");

    const payout = __getPayout("p1");
    expect(payout?.approvers.has("admin1")).toBe(true);
  });

  it("triggers processing when threshold reached", async () => {
    __seedPayout({ id: "p1", workspaceId: "ws1", status: "pending", approvers: ["admin1"], requiredApprovals: 2 });

    const res = await request(app).post("/lancepay/payouts/p1/approve").send({ adminId: "admin2" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.approvals).toBe(2);
    expect(res.body.data.status).toBe("processing");

    const payout = __getPayout("p1");
    expect(payout?.status).toBe("processing");
  });

  it("rejects unauthorized caller (no adminId)", async () => {
    __seedPayout({ id: "p1", workspaceId: "ws1", status: "pending", approvers: [], requiredApprovals: 2 });

    const res = await request(app).post("/lancepay/payouts/p1/approve").send({});

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("does not increase count on duplicate approval", async () => {
    __seedPayout({ id: "p1", workspaceId: "ws1", status: "pending", approvers: ["admin1"], requiredApprovals: 2 });

    const res = await request(app).post("/lancepay/payouts/p1/approve").send({ adminId: "admin1" });

    expect(res.status).toBe(200);
    expect(res.body.data.approvals).toBe(1);
  });
});
