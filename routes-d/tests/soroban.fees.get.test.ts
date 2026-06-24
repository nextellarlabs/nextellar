import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import feesRouter, {
  __resetFeeCache,
  __setRpcAvailable,
  __seedCache,
} from "../routes/soroban.fees.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(feesRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /soroban/fees", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetFeeCache();
  });

  it("returns 200 with baseFee, resourceFee, and percentile data when RPC is available", async () => {
    const res = await request(app).get("/soroban/fees");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.baseFee).toBeDefined();
    expect(res.body.data.resourceFee).toBeDefined();
    expect(res.body.data.baseFee.p50).toBeDefined();
    expect(res.body.data.baseFee.p99).toBeDefined();
    expect(res.body.data.resourceFee.p50).toBeDefined();
    expect(res.body.data.resourceFee.p99).toBeDefined();
    expect(res.body.data.latestLedger).toBeDefined();
    expect(res.body.data.fromCache).toBe(false);
  });

  it("returns 503 RPC_UNAVAILABLE when the Soroban RPC cannot be reached", async () => {
    __setRpcAvailable(false);

    const res = await request(app).get("/soroban/fees");

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("RPC_UNAVAILABLE");
  });

  it("returns cached data without hitting RPC on second request within TTL", async () => {
    const seedStats = {
      baseFee: { min: "100", max: "500", mode: "100", p10: "100", p50: "150", p99: "450" },
      resourceFee: { min: "200", max: "1000", mode: "300", p10: "200", p50: "350", p99: "900" },
      latestLedger: 99999,
      cachedAt: Date.now(),
    };
    __seedCache(seedStats);
    __setRpcAvailable(false);

    const res = await request(app).get("/soroban/fees");

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(true);
    expect(res.body.data.latestLedger).toBe(99999);
  });

  it("returns fromCache:false on fresh request when cache is empty", async () => {
    const res = await request(app).get("/soroban/fees");

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(false);
  });
});
