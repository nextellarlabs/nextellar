import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, { __clearFxQuoteCache } from "../routes/lancepay.fx.quote.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /lancepay/fx/quote", () => {
  const app = buildApp();

  beforeEach(() => {
    __clearFxQuoteCache();
  });

  it("returns quote for deep liquidity request", async () => {
    const res = await request(app)
      .post("/lancepay/fx/quote")
      .send({ fromAsset: "USDC", toAsset: "NGN", amount: 100 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.expectedOutput).toBeGreaterThan(0);
    expect(res.body.data.liquidity).toBe("deep");
    expect(res.body.data.spread).toBe(0.005);
  });

  it("returns quote with higher spread/priceImpact for thin liquidity", async () => {
    const res = await request(app)
      .post("/lancepay/fx/quote")
      .send({ fromAsset: "USDC", toAsset: "NGN", amount: 150000 });

    expect(res.status).toBe(200);
    expect(res.body.data.liquidity).toBe("thin");
    expect(res.body.data.priceImpact).toBe(0.05);
  });

  it("returns 404 for unknown currency pair", async () => {
    const res = await request(app)
      .post("/lancepay/fx/quote")
      .send({ fromAsset: "BTC", toAsset: "XYZ", amount: 10 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("UNKNOWN_PAIR");
  });

  it("serves cached quote for identical recent requests", async () => {
    const payload = { fromAsset: "USDC", toAsset: "EUR", amount: 500 };
    const res1 = await request(app).post("/lancepay/fx/quote").send(payload);
    expect(res1.body.cached).toBe(false);

    const res2 = await request(app).post("/lancepay/fx/quote").send(payload);
    expect(res2.body.cached).toBe(true);
  });
});
