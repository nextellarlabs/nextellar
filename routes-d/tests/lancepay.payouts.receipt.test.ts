import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedPayout,
  __resetPayouts,
} from "../routes/lancepay.payouts.receipt.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const completedPayout = {
  id: "pay-completed",
  workspaceId: "ws-1",
  contractorId: "con-1",
  destinationWallet: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  amount: 500,
  currency: "USD",
  status: "completed" as const,
  settledAt: "2026-06-20T12:00:00Z",
  stellarTxHash: "abc123def",
  createdAt: "2026-06-20T11:00:00Z",
};

const pendingPayout = {
  ...completedPayout,
  id: "pay-pending",
  status: "pending" as const,
  settledAt: undefined,
};

describe("GET /lancepay/payouts/:id/receipt", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetPayouts();
    __seedPayout(completedPayout);
    __seedPayout(pendingPayout);
  });

  it("streams PDF receipt for a completed payout", async () => {
    const res = await request(app)
      .get("/lancepay/payouts/pay-completed/receipt")
      .set("x-user-id", "ws-1");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toContain("pay-completed");
    expect(res.body).toBeDefined();
  });

  it("returns 401 when x-user-id header is missing", async () => {
    const res = await request(app).get("/lancepay/payouts/pay-completed/receipt");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 when caller is not the workspace or contractor", async () => {
    const res = await request(app)
      .get("/lancepay/payouts/pay-completed/receipt")
      .set("x-user-id", "other-user");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 for unknown payout id", async () => {
    const res = await request(app)
      .get("/lancepay/payouts/nonexistent/receipt")
      .set("x-user-id", "ws-1");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 409 when payout is not yet settled (pending status)", async () => {
    const res = await request(app)
      .get("/lancepay/payouts/pay-pending/receipt")
      .set("x-user-id", "ws-1");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PAYOUT_NOT_SETTLED");
  });

  it("allows contractor to download their own receipt", async () => {
    const res = await request(app)
      .get("/lancepay/payouts/pay-completed/receipt")
      .set("x-user-id", "con-1");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
  });
});
