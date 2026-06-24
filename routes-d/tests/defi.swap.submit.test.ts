import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import defiSwapSubmitRouter, { __resetSwapSubmit } from "../routes/defi.swap.submit.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(defiSwapSubmitRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /defi/swap", () => {
  const app = buildApp();

  const validSwapRequest = {
    fromAsset: { code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
    toAsset: { code: "XLM" },
    amount: "100",
    slippage: "1",
    accountId: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG",
  };

  beforeEach(() => {
    __resetSwapSubmit();
  });

  it("returns 201 with unsigned envelope for valid swap request", async () => {
    const res = await request(app).post("/defi/swap").send(validSwapRequest);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.fromAsset.code).toBe("USDC");
    expect(res.body.data.toAsset.code).toBe("XLM");
    expect(res.body.data.amount).toBe("100");
    expect(res.body.data.slippage).toBe("1");
    expect(res.body.data.accountId).toBe("GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG");
    expect(res.body.data.envelope).toBeDefined();
    expect(res.body.data.relayUrl).toBeDefined();
  });

  it("returns 422 MISSING_PATH when fromAsset or toAsset is missing code", async () => {
    const res = await request(app).post("/defi/swap").send({
      ...validSwapRequest,
      fromAsset: { code: "" },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FROM_ASSET_CODE");
  });

  it("returns 422 MISSING_PATH when toAsset is missing code", async () => {
    const res = await request(app).post("/defi/swap").send({
      ...validSwapRequest,
      toAsset: { code: "" },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TO_ASSET_CODE");
  });

  it("returns 400 when amount is not a positive number", async () => {
    const res = await request(app).post("/defi/swap").send({
      ...validSwapRequest,
      amount: "-50",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 when slippage is 0 or negative", async () => {
    const res = await request(app).post("/defi/swap").send({
      ...validSwapRequest,
      slippage: "0",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SLIPPAGE");
  });

  it("returns 400 when slippage exceeds 100", async () => {
    const res = await request(app).post("/defi/swap").send({
      ...validSwapRequest,
      slippage: "101",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SLIPPAGE");
  });

  it("returns 400 when accountId is invalid", async () => {
    const res = await request(app).post("/defi/swap").send({
      ...validSwapRequest,
      accountId: "INVALID",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ACCOUNT_ID");
  });

  it("returns 400 when fromAsset and toAsset are the same", async () => {
    const res = await request(app).post("/defi/swap").send({
      ...validSwapRequest,
      fromAsset: { code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
      toAsset: { code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ASSET_PAIR");
  });

  it("returns 400 when fromAsset.code is missing", async () => {
    const res = await request(app).post("/defi/swap").send({
      ...validSwapRequest,
      fromAsset: { issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FROM_ASSET_CODE");
  });

  it("returns 400 when toAsset.code is missing", async () => {
    const res = await request(app).post("/defi/swap").send({
      ...validSwapRequest,
      toAsset: {},
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TO_ASSET_CODE");
  });

  it("returns 400 when amount is missing", async () => {
    const res = await request(app).post("/defi/swap").send({
      ...validSwapRequest,
      amount: "",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 when slippage is missing", async () => {
    const res = await request(app).post("/defi/swap").send({
      ...validSwapRequest,
      slippage: "",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SLIPPAGE");
  });

  it("response envelope includes relayUrl", async () => {
    const res = await request(app).post("/defi/swap").send(validSwapRequest);

    expect(res.status).toBe(201);
    expect(res.body.data.relayUrl).toBe("https://relay.example.com/v1/swap");
  });
});