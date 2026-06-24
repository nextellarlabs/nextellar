import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import strictSendRouter from "../routes/stellar.payment.strictSend.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(strictSendRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const VALID_ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

const validPayload = {
  sourceAccount: VALID_ACCOUNT,
  sendAsset: { code: "XLM" },
  sendAmount: "100",
  destination: VALID_ACCOUNT,
  destAsset: { code: "USDC", issuer: VALID_ACCOUNT },
  destMin: "10",
  path: [],
};

describe("POST /stellar/payment/strict-send", () => {
  const app = buildApp();

  it("builds an unsigned envelope for a valid strict-send request", async () => {
    const res = await request(app)
      .post("/stellar/payment/strict-send")
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.envelope).toBeDefined();
    expect(typeof res.body.data.envelope).toBe("string");
    expect(res.body.data.networkPassphrase).toBeDefined();
  });

  it("returns 400 when sourceAccount is missing", async () => {
    const { sourceAccount, ...rest } = validPayload;
    const res = await request(app)
      .post("/stellar/payment/strict-send")
      .send(rest);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE");
  });

  it("returns 400 when sendAmount is not a positive number", async () => {
    const res = await request(app)
      .post("/stellar/payment/strict-send")
      .send({ ...validPayload, sendAmount: "-5" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SEND_AMOUNT");
  });

  it("returns 400 when sendAmount is not numeric", async () => {
    const res = await request(app)
      .post("/stellar/payment/strict-send")
      .send({ ...validPayload, sendAmount: "abc" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SEND_AMOUNT");
  });

  it("returns 400 when destMin is missing", async () => {
    const { destMin, ...rest } = validPayload;
    const res = await request(app)
      .post("/stellar/payment/strict-send")
      .send(rest);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DEST_MIN");
  });

  it("returns 400 on slippage breach", async () => {
    const res = await request(app)
      .post("/stellar/payment/strict-send")
      .send({ ...validPayload, sendAmount: "1", destMin: "100000" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SLIPPAGE_BREACH");
  });

  it("returns 400 when sendAsset is missing", async () => {
    const { sendAsset, ...rest } = validPayload;
    const res = await request(app)
      .post("/stellar/payment/strict-send")
      .send(rest);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SEND_ASSET");
  });

  it("returns 400 when destination is missing", async () => {
    const { destination, ...rest } = validPayload;
    const res = await request(app)
      .post("/stellar/payment/strict-send")
      .send(rest);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DESTINATION");
  });

  it("accepts a path with intermediate assets", async () => {
    const res = await request(app)
      .post("/stellar/payment/strict-send")
      .send({
        ...validPayload,
        path: [{ code: "EUR", issuer: VALID_ACCOUNT }],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.envelope).toBeDefined();
  });
});
