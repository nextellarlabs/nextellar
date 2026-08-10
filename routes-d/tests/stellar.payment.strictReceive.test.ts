import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import strictReceiveRouter from "../routes/stellar.payment.strictReceive.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(strictReceiveRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const VALID_ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

const validPayload = {
  sourceAccount: VALID_ACCOUNT,
  sendAsset: { code: "XLM" },
  sourceMax: "100",
  destination: VALID_ACCOUNT,
  destAsset: { code: "USDC", issuer: VALID_ACCOUNT },
  destAmount: "10",
  path: [],
};

describe("POST /stellar/payment/strict-receive", () => {
  const app = buildApp();

  it("builds a valid unsigned XDR envelope for a correct strict-receive request", async () => {
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.envelope).toBe("string");
    expect(res.body.data.envelope.length).toBeGreaterThan(0);
    expect(res.body.data.networkPassphrase).toBeDefined();
  });

  it("succeeds when the path field is omitted (defaults to empty path)", async () => {
    const { path: _path, ...payloadWithoutPath } = validPayload;
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send(payloadWithoutPath);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.envelope).toBeDefined();
  });

  it("succeeds when sourceMax equals destAmount (no breach)", async () => {
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send({ ...validPayload, sourceMax: "10", destAmount: "10" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 400 SOURCE_MAX_BREACH when sourceMax exceeds 1000x destAmount", async () => {
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send({ ...validPayload, sourceMax: "10000", destAmount: "1" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SOURCE_MAX_BREACH");
  });

  it("returns 400 INVALID_SOURCE when sourceAccount is missing", async () => {
    const { sourceAccount: _, ...rest } = validPayload;
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send(rest);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE");
  });

  it("returns 400 INVALID_SEND_ASSET when sendAsset is missing", async () => {
    const { sendAsset: _, ...rest } = validPayload;
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send(rest);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SEND_ASSET");
  });

  it("returns 400 INVALID_SOURCE_MAX when sourceMax is negative", async () => {
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send({ ...validPayload, sourceMax: "-5" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE_MAX");
  });

  it("returns 400 INVALID_SOURCE_MAX when sourceMax is non-numeric", async () => {
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send({ ...validPayload, sourceMax: "abc" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE_MAX");
  });

  it("returns 400 INVALID_DESTINATION when destination is missing", async () => {
    const { destination: _, ...rest } = validPayload;
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send(rest);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DESTINATION");
  });

  it("returns 400 INVALID_DEST_ASSET when destAsset is missing", async () => {
    const { destAsset: _, ...rest } = validPayload;
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send(rest);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DEST_ASSET");
  });

  it("returns 400 INVALID_DEST_AMOUNT when destAmount is missing", async () => {
    const { destAmount: _, ...rest } = validPayload;
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send(rest);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DEST_AMOUNT");
  });

  it("returns 400 INVALID_DEST_AMOUNT when destAmount is not positive", async () => {
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send({ ...validPayload, destAmount: "0" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DEST_AMOUNT");
  });

  it("accepts a path with intermediate assets and builds a valid envelope", async () => {
    const res = await request(app)
      .post("/stellar/payment/strict-receive")
      .send({
        ...validPayload,
        path: [{ code: "EUR", issuer: VALID_ACCOUNT }],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.envelope).toBeDefined();
  });
});
