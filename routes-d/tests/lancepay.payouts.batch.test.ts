import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __getBatchResults,
  __resetBatchResults,
} from "../routes/lancepay.payouts.batch.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const VALID_PAYOUT = {
  contractorId: "con-1",
  destinationWallet: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  amount: 100,
  currency: "USD",
};

const VALID_BODY = { workspaceId: "ws-1", payouts: [VALID_PAYOUT] };

describe("POST /lancepay/payouts/batch", () => {
  const app = buildApp();

  beforeEach(() => __resetBatchResults());

  it("processes a valid batch and returns 201", async () => {
    const res = await request(app).post("/lancepay/payouts/batch").send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.succeeded).toBe(1);
    expect(res.body.data.failed).toBe(0);
    expect(res.body.data.outcomes[0].status).toBe("pending");
  });

  it("returns per-row outcomes on partial failure", async () => {
    const body = {
      workspaceId: "ws-1",
      payouts: [
        VALID_PAYOUT,
        { contractorId: "con-2", destinationWallet: "bad-wallet", amount: 50, currency: "USD" },
      ],
    };
    const res = await request(app).post("/lancepay/payouts/batch").send(body);
    expect(res.status).toBe(201); // at least one succeeded
    expect(res.body.data.succeeded).toBe(1);
    expect(res.body.data.failed).toBe(1);
    const failedRow = res.body.data.outcomes.find((o: { status: string }) => o.status === "failed");
    expect(failedRow.error).toMatch(/destinationWallet/);
  });

  it("returns 422 when entire batch fails", async () => {
    const body = {
      workspaceId: "ws-1",
      payouts: [
        { contractorId: "con-1", destinationWallet: "bad", amount: -1, currency: "XYZ" },
      ],
    };
    const res = await request(app).post("/lancepay/payouts/batch").send(body);
    expect(res.status).toBe(422);
    expect(res.body.data.failed).toBe(1);
  });

  it("returns idempotent result on repeat upload", async () => {
    const first = await request(app).post("/lancepay/payouts/batch").send(VALID_BODY);
    const batchId = first.body.data.batchId;

    const second = await request(app).post("/lancepay/payouts/batch").send(VALID_BODY);
    expect(second.status).toBe(200);
    expect(second.body.data.idempotent).toBe(true);
    expect(second.body.data.batchId).toBe(batchId);
    expect(__getBatchResults().size).toBe(1);
  });

  it("returns 400 for empty payouts array", async () => {
    const res = await request(app)
      .post("/lancepay/payouts/batch")
      .send({ workspaceId: "ws-1", payouts: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("EMPTY_BATCH");
  });

  it("returns 400 when workspaceId is missing", async () => {
    const res = await request(app)
      .post("/lancepay/payouts/batch")
      .send({ payouts: [VALID_PAYOUT] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WORKSPACE_ID");
  });

  it("returns 400 when payouts is not an array", async () => {
    const res = await request(app)
      .post("/lancepay/payouts/batch")
      .send({ workspaceId: "ws-1", payouts: "not-an-array" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAYOUTS");
  });

  it("assigns unique payoutId to each successful row", async () => {
    const body = { workspaceId: "ws-1", payouts: [VALID_PAYOUT, { ...VALID_PAYOUT, contractorId: "con-2" }] };
    const res = await request(app).post("/lancepay/payouts/batch").send(body);
    const ids = res.body.data.outcomes.map((o: { payoutId: string }) => o.payoutId);
    expect(new Set(ids).size).toBe(2);
  });
});
