import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedPayout,
  __resetPayouts,
  __getPayout,
  __getWebhookLog,
} from "../routes/lancepay.payouts.cancel.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const app = buildApp();

const BASE_PAYOUT = {
  id: "pay-1",
  workspaceId: "ws-1",
  status: "pending" as const,
};

describe("POST /lancepay/payouts/:id/cancel", () => {
  beforeEach(() => {
    __resetPayouts();
    __seedPayout(BASE_PAYOUT);
  });

  it("cancels a pending payout", async () => {
    const res = await request(app)
      .post("/lancepay/payouts/pay-1/cancel")
      .set("x-workspace-id", "ws-1");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("cancelled");
    expect(res.body.data.payoutId).toBe("pay-1");
    expect(res.body.data.cancelledAt).toBeTruthy();
    expect(res.body.data.cancelledBy).toBe("ws-1");
  });

  it("cancels a queued payout", async () => {
    __seedPayout({ ...BASE_PAYOUT, id: "pay-q", status: "queued" });

    const res = await request(app)
      .post("/lancepay/payouts/pay-q/cancel")
      .set("x-workspace-id", "ws-1");

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
  });

  it("emits a cancellation webhook on success", async () => {
    await request(app)
      .post("/lancepay/payouts/pay-1/cancel")
      .set("x-workspace-id", "ws-1");

    const log = __getWebhookLog();
    expect(log).toHaveLength(1);
    expect(log[0].event).toBe("payout.cancelled");
    expect(log[0].payoutId).toBe("pay-1");
    expect(log[0].cancelledBy).toBe("ws-1");
  });

  it("persists the cancelled status in the store", async () => {
    await request(app)
      .post("/lancepay/payouts/pay-1/cancel")
      .set("x-workspace-id", "ws-1");

    const payout = __getPayout("pay-1");
    expect(payout?.status).toBe("cancelled");
    expect(payout?.cancelledBy).toBe("ws-1");
  });

  it("returns 409 when payout is already submitted to Stellar", async () => {
    __seedPayout({ ...BASE_PAYOUT, id: "pay-sub", status: "submitted" });

    const res = await request(app)
      .post("/lancepay/payouts/pay-sub/cancel")
      .set("x-workspace-id", "ws-1");

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_SUBMITTED");
  });

  it("returns 409 for processing status (already in Stellar pipeline)", async () => {
    __seedPayout({ ...BASE_PAYOUT, id: "pay-proc", status: "processing" });

    const res = await request(app)
      .post("/lancepay/payouts/pay-proc/cancel")
      .set("x-workspace-id", "ws-1");

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_SUBMITTED");
  });

  it("returns 409 when already cancelled", async () => {
    __seedPayout({ ...BASE_PAYOUT, id: "pay-can", status: "cancelled" });

    const res = await request(app)
      .post("/lancepay/payouts/pay-can/cancel")
      .set("x-workspace-id", "ws-1");

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_CANCELLED");
  });

  it("returns 403 when caller does not own the payout", async () => {
    const res = await request(app)
      .post("/lancepay/payouts/pay-1/cancel")
      .set("x-workspace-id", "ws-other");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 401 when x-workspace-id header is missing", async () => {
    const res = await request(app).post("/lancepay/payouts/pay-1/cancel");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 404 for an unknown payout id", async () => {
    const res = await request(app)
      .post("/lancepay/payouts/does-not-exist/cancel")
      .set("x-workspace-id", "ws-1");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("does not emit a webhook on a failed cancellation", async () => {
    __seedPayout({ ...BASE_PAYOUT, id: "pay-sub2", status: "submitted" });

    await request(app)
      .post("/lancepay/payouts/pay-sub2/cancel")
      .set("x-workspace-id", "ws-1");

    expect(__getWebhookLog()).toHaveLength(0);
  });
});
