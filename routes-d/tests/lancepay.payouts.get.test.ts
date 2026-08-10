import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedPayout,
  __resetPayouts,
} from "../routes/lancepay.payouts.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const BASE_PAYOUT = {
  id: "pay-1",
  workspaceId: "ws-1",
  contractorId: "con-1",
  destinationWallet: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  amount: 500,
  currency: "USD",
  status: "completed" as const,
  fees: 2.5,
  stellarTxHash: "abc123stellartx",
  createdAt: "2026-06-20T10:00:00Z",
  settledAt: "2026-06-20T12:00:00Z",
};

describe("GET /lancepay/payouts/:id", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetPayouts();
    __seedPayout(BASE_PAYOUT);
  });

  it("returns payout details for workspace member", async () => {
    const res = await request(app)
      .get("/lancepay/payouts/pay-1")
      .set("x-caller-id", "ws-1");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe("pay-1");
    expect(res.body.data.status).toBe("completed");
    expect(res.body.data.amount).toBe(500);
    expect(res.body.data.currency).toBe("USD");
    expect(res.body.data.fees).toBe(2.5);
    expect(res.body.data.stellarTxHash).toBe("abc123stellartx");
    expect(res.body.data.settledAt).toBe("2026-06-20T12:00:00Z");
  });

  it("returns payout details for destination contractor", async () => {
    const res = await request(app)
      .get("/lancepay/payouts/pay-1")
      .set("x-caller-id", "con-1");

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe("pay-1");
    expect(res.body.data.contractorId).toBe("con-1");
  });

  it("includes retry history when present", async () => {
    __seedPayout({
      ...BASE_PAYOUT,
      id: "pay-retry",
      status: "failed",
      retryHistory: [
        { attemptedAt: "2026-06-20T10:05:00Z", reason: "network timeout" },
        { attemptedAt: "2026-06-20T10:15:00Z", reason: "insufficient funds" },
      ],
    });

    const res = await request(app)
      .get("/lancepay/payouts/pay-retry")
      .set("x-caller-id", "ws-1");

    expect(res.status).toBe(200);
    expect(res.body.data.retryHistory).toHaveLength(2);
    expect(res.body.data.retryHistory[0].reason).toBe("network timeout");
  });

  it("omits retryHistory when not present", async () => {
    const res = await request(app)
      .get("/lancepay/payouts/pay-1")
      .set("x-caller-id", "ws-1");

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty("retryHistory");
  });

  it("returns 404 for unknown payout id", async () => {
    const res = await request(app)
      .get("/lancepay/payouts/nonexistent")
      .set("x-caller-id", "ws-1");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 403 for cross-workspace caller", async () => {
    const res = await request(app)
      .get("/lancepay/payouts/pay-1")
      .set("x-caller-id", "ws-other");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 401 when x-caller-id header is missing", async () => {
    const res = await request(app).get("/lancepay/payouts/pay-1");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("MISSING_CALLER");
  });
});
