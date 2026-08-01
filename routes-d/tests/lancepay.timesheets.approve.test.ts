import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, { __seedTimesheet, __getTimesheet, __isPayoutQueued, __resetTimesheets } from "../routes/lancepay.timesheets.approve.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /lancepay/timesheets/:id/approve", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetTimesheets();
  });

  it("approves a pending timesheet and queues the payout draft", async () => {
    __seedTimesheet({
      id: "ts1",
      workspaceId: "ws1",
      contractorId: "c1",
      status: "pending",
      amount: 1000,
      currency: "USD",
    });

    const res = await request(app).post("/lancepay/timesheets/ts1/approve").send({ approverId: "approver1" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("approved");
    expect(res.body.data.payoutQueued).toBe(true);

    const timesheet = __getTimesheet("ts1");
    expect(timesheet?.status).toBe("approved");
    expect(__isPayoutQueued("ts1")).toBe(true);
  });

  it("returns already approved if the timesheet was previously approved", async () => {
    __seedTimesheet({
      id: "ts1",
      workspaceId: "ws1",
      contractorId: "c1",
      status: "approved",
      amount: 1000,
      currency: "USD",
    });

    const res = await request(app).post("/lancepay/timesheets/ts1/approve").send({ approverId: "approver1" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("approved");
    expect(res.body.message).toBe("Already approved");
  });

  it("rejects an unauthorized approver (no approverId provided)", async () => {
    __seedTimesheet({
      id: "ts1",
      workspaceId: "ws1",
      contractorId: "c1",
      status: "pending",
      amount: 1000,
      currency: "USD",
    });

    const res = await request(app).post("/lancepay/timesheets/ts1/approve").send({});

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
