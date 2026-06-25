import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import swapQuoteRouter, {
  __resetQuoteCache,
  __seedQuoteCache,
} from "../routes/defi.swap.quote.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(swapQuoteRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /defi/swap/quote", () => {
  const app = buildApp();

  const deepLiquidityRequest = {
    fromAsset: { code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
    toAsset: { code: "XLM" },
    amount: "100",
  };

  const thinLiquidityRequest = {
    fromAsset: { code: "BTC", issuer: "GDPJALI4AZKUU2W426U5WKMAT6CN3AJRPIIRYR2YM54TL2GDWO5O2MZM" },
    toAsset: { code: "XLM" },
    amount: "1",
  };

  beforeEach(() => {
    __resetQuoteCache();
  });

  it("returns 201 with a low priceImpact for a deep liquidity pair", async () => {
    const res = await request(app).post("/defi/swap/quote").send(deepLiquidityRequest);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(parseFloat(res.body.data.priceImpact)).toBeLessThanOrEqual(0.05);
    expect(res.body.data.fromCache).toBe(false);
  });

  it("returns 201 with a high priceImpact for a thin liquidity pair", async () => {
    const res = await request(app).post("/defi/swap/quote").send(thinLiquidityRequest);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(parseFloat(res.body.data.priceImpact)).toBeGreaterThanOrEqual(5);
    expect(res.body.data.fromCache).toBe(false);
  });

  it("returns 422 UNKNOWN_PAIR for an unrecognised asset pair", async () => {
    const res = await request(app).post("/defi/swap/quote").send({
      fromAsset: { code: "EXOTIC" },
      toAsset: { code: "RARE" },
      amount: "10",
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("UNKNOWN_PAIR");
  });

  it("returns 400 INVALID_ASSET_PAIR when fromAsset and toAsset are the same", async () => {
    const res = await request(app).post("/defi/swap/quote").send({
      fromAsset: { code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
      toAsset: { code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
      amount: "50",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ASSET_PAIR");
  });

  it("returns fromCache: true on a second identical request within the TTL window", async () => {
    await request(app).post("/defi/swap/quote").send(deepLiquidityRequest);
    const res = await request(app).post("/defi/swap/quote").send(deepLiquidityRequest);

    expect(res.status).toBe(201);
    expect(res.body.data.fromCache).toBe(true);
  });

  it("returns 400 INVALID_FROM_ASSET when fromAsset is missing", async () => {
    const res = await request(app).post("/defi/swap/quote").send({
      toAsset: { code: "XLM" },
      amount: "10",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FROM_ASSET");
  });

  it("returns 400 INVALID_FROM_ASSET_CODE when fromAsset.code is missing", async () => {
    const res = await request(app).post("/defi/swap/quote").send({
      fromAsset: { issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
      toAsset: { code: "XLM" },
      amount: "10",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_FROM_ASSET_CODE");
  });

  it("returns 400 INVALID_TO_ASSET when toAsset is missing", async () => {
    const res = await request(app).post("/defi/swap/quote").send({
      fromAsset: { code: "USDC" },
      amount: "10",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TO_ASSET");
  });

  it("returns 400 INVALID_TO_ASSET_CODE when toAsset.code is missing", async () => {
    const res = await request(app).post("/defi/swap/quote").send({
      fromAsset: { code: "USDC" },
      toAsset: {},
      amount: "10",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TO_ASSET_CODE");
  });

  it("returns 400 INVALID_AMOUNT when amount is zero", async () => {
    const res = await request(app).post("/defi/swap/quote").send({
      ...deepLiquidityRequest,
      amount: "0",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 INVALID_AMOUNT when amount is negative", async () => {
    const res = await request(app).post("/defi/swap/quote").send({
      ...deepLiquidityRequest,
      amount: "-10",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 INVALID_AMOUNT when amount is missing", async () => {
    const res = await request(app).post("/defi/swap/quote").send({
      fromAsset: { code: "USDC" },
      toAsset: { code: "XLM" },
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("response data has the expected shape", async () => {
    const res = await request(app).post("/defi/swap/quote").send(deepLiquidityRequest);

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty("fromAsset");
    expect(res.body.data).toHaveProperty("toAsset");
    expect(res.body.data).toHaveProperty("inputAmount");
    expect(res.body.data).toHaveProperty("outputAmount");
    expect(res.body.data).toHaveProperty("fees");
    expect(res.body.data.fees).toHaveProperty("protocol");
    expect(res.body.data.fees).toHaveProperty("network");
    expect(res.body.data).toHaveProperty("priceImpact");
    expect(res.body.data).toHaveProperty("fromCache");
  });

  it("seeded cache entry is returned as a cache hit", async () => {
    const seedData = {
      fromAsset: { code: "USDC" },
      toAsset: { code: "XLM" },
      inputAmount: "50",
      outputAmount: "49.850",
      fees: { protocol: "0.30", network: "0.01" },
      priceImpact: "0.04",
      fromCache: false,
    };
    __seedQuoteCache("USDC:XLM:50", seedData);

    const res = await request(app).post("/defi/swap/quote").send({
      fromAsset: { code: "USDC" },
      toAsset: { code: "XLM" },
      amount: "50",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.fromCache).toBe(true);
    expect(res.body.data.outputAmount).toBe("49.850");
  });
});
