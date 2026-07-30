import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import tradeAggregationsRouter, { __resetTradeAggregations } from "../routes/stellar.trades.aggregate.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(tradeAggregationsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /stellar/trades", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetTradeAggregations();
  });

  it("returns 200 with aggregations for a valid small time range", async () => {
    const now = Date.now();
    const res = await request(app).get("/stellar/trades")
      .query({
        baseAssetCode: "XLM",
        counterAssetCode: "USD",
        resolution: "1h",
        startTime: String(now - 60 * 60 * 1000),
        endTime: String(now),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.baseAsset.code).toBe("XLM");
    expect(res.body.data.counterAsset.code).toBe("USD");
    expect(res.body.data.resolution).toBe("1h");
    expect(Array.isArray(res.body.data.aggregations)).toBe(true);
    expect(res.body.data.aggregations.length).toBeGreaterThan(0);
  });

  it("caps large time ranges to the maximum allowed", async () => {
    const now = Date.now();
    const tooOld = now - 60 * 24 * 60 * 60 * 1000; // 60 days ago

    const res = await request(app).get("/stellar/trades")
      .query({
        baseAssetCode: "XLM",
        counterAssetCode: "USD",
        resolution: "1d",
        startTime: String(tooOld),
        endTime: String(now),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 400 for invalid resolution", async () => {
    const now = Date.now();
    const res = await request(app).get("/stellar/trades")
      .query({
        baseAssetCode: "XLM",
        counterAssetCode: "USD",
        resolution: "invalid",
        startTime: String(now - 60 * 60 * 1000),
        endTime: String(now),
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_RESOLUTION");
  });

  it("returns 400 when baseAssetCode is missing", async () => {
    const res = await request(app).get("/stellar/trades")
      .query({
        counterAssetCode: "USD",
        resolution: "1h",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_BASE_ASSET");
  });

  it("returns 400 when counterAssetCode is missing", async () => {
    const res = await request(app).get("/stellar/trades")
      .query({
        baseAssetCode: "XLM",
        resolution: "1h",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_COUNTER_ASSET");
  });

  it("returns 400 when startTime >= endTime", async () => {
    const now = Date.now();
    const res = await request(app).get("/stellar/trades")
      .query({
        baseAssetCode: "XLM",
        counterAssetCode: "USD",
        resolution: "1h",
        startTime: String(now),
        endTime: String(now - 60 * 60 * 1000),
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_TIME_RANGE");
  });

  it("returns default aggregations when no startTime/endTime provided", async () => {
    const res = await request(app).get("/stellar/trades")
      .query({
        baseAssetCode: "XLM",
        counterAssetCode: "USD",
        resolution: "1h",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.aggregations)).toBe(true);
  });

  it("includes issuer in asset when provided", async () => {
    const now = Date.now();
    const res = await request(app).get("/stellar/trades")
      .query({
        baseAssetCode: "USD",
        baseAssetIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        counterAssetCode: "XLM",
        resolution: "1h",
        startTime: String(now - 60 * 60 * 1000),
        endTime: String(now),
      });

    expect(res.status).toBe(200);
    expect(res.body.data.baseAsset.issuer).toBe("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
  });
});