import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __getPayouts,
  __resetPayouts,
  __freezeContractor,
  __unfreezeContractor,
} from "../routes/lancepay.payouts.create.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const VALID_BODY = {
  workspaceId: "ws-1",
  contractorId: "con-1",
  destinationWallet: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  amount: 500,
  currency: "USD",
};

describe("POST /lancepay/payouts", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetPayouts();
    __unfreezeContractor("con-1");
  });

  it("creates a payout with valid data", async () => {
    const res = await request(app).post("/lancepay/payouts").send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("id");
    expect(res.body.data.status).toBe("pending");
    expect(res.body.data.currency).toBe("USD");
  });

  it("returns 400 when workspaceId is missing", async () => {
    const { workspaceId: _w, ...rest } = VALID_BODY;
    const res = await request(app).post("/lancepay/payouts").send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WORKSPACE_ID");
  });

  it("returns 400 when contractorId is missing", async () => {
    const { contractorId: _c, ...rest } = VALID_BODY;
    const res = await request(app).post("/lancepay/payouts").send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CONTRACTOR_ID");
  });

  it("returns 400 when destinationWallet is invalid", async () => {
    const res = await request(app)
      .post("/lancepay/payouts")
      .send({ ...VALID_BODY, destinationWallet: "not-a-wallet" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DESTINATION_WALLET");
  });

  it("returns 400 when amount is zero", async () => {
    const res = await request(app)
      .post("/lancepay/payouts")
      .send({ ...VALID_BODY, amount: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 when amount is negative", async () => {
    const res = await request(app)
      .post("/lancepay/payouts")
      .send({ ...VALID_BODY, amount: -100 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 for unsupported currency", async () => {
    const res = await request(app)
      .post("/lancepay/payouts")
      .send({ ...VALID_BODY, currency: "ZZZ" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CURRENCY");
  });

  it("rejects payout when contractor is frozen", async () => {
    __freezeContractor("con-1");
    const res = await request(app).post("/lancepay/payouts").send(VALID_BODY);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("CONTRACTOR_FROZEN");
  });

  it("returns idempotent response on duplicate idempotency key", async () => {
    const first = await request(app)
      .post("/lancepay/payouts")
      .send({ ...VALID_BODY, idempotencyKey: "idem-1" });
    expect(first.status).toBe(201);
    const payoutId = first.body.data.id;

    const second = await request(app)
      .post("/lancepay/payouts")
      .send({ ...VALID_BODY, idempotencyKey: "idem-1" });
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
    expect(second.body.data.id).toBe(payoutId);
    expect(__getPayouts().size).toBe(1);
  });

  it("normalises currency to uppercase", async () => {
    const res = await request(app)
      .post("/lancepay/payouts")
      .send({ ...VALID_BODY, currency: "xlm" });
    expect(res.status).toBe(201);
    expect(res.body.data.currency).toBe("XLM");
  });
});
