import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import poolsRouter, { __resetPools } from "../routes/defi.pools.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(poolsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /defi/pools/:id", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetPools();
  });

  it("returns 200 with correct data for known pool pool-usdc-xlm", async () => {
    const res = await request(app).get("/defi/pools/pool-usdc-xlm");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe("pool-usdc-xlm");
    expect(res.body.data.reserves.assetA.code).toBe("USDC");
    expect(res.body.data.reserves.assetA.issuer).toBe("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
    expect(res.body.data.reserves.assetA.amount).toBe("1000000.00");
    expect(res.body.data.reserves.assetB.code).toBe("XLM");
    expect(res.body.data.reserves.assetB.issuer).toBe("native");
    expect(res.body.data.reserves.assetB.amount).toBe("50000000.00");
    expect(res.body.data.totalShares).toBe("7071067.81");
    expect(res.body.data.apyEstimate).toBe("5.04");
    expect(res.body.data.recentActivity.tradesLast24h).toBe(142);
    expect(res.body.data.recentActivity.volumeLast24h).toBe("500000.00");
  });

  it("returns 404 POOL_NOT_FOUND for unknown pool", async () => {
    const res = await request(app).get("/defi/pools/pool-nonexistent");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("POOL_NOT_FOUND");
    expect(res.body.error.message).toBe("Liquidity pool not found");
  });

  it("returns 200 with APY 0.00 for zero-reserve pool", async () => {
    const res = await request(app).get("/defi/pools/pool-zero");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe("pool-zero");
    expect(res.body.data.apyEstimate).toBe("0.00");
  });

  it("response has correct shape with all required fields", async () => {
    const res = await request(app).get("/defi/pools/pool-usdc-xlm");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("data");
    expect(res.body.data).toHaveProperty("id");
    expect(res.body.data).toHaveProperty("reserves");
    expect(res.body.data).toHaveProperty("totalShares");
    expect(res.body.data).toHaveProperty("apyEstimate");
    expect(res.body.data).toHaveProperty("recentActivity");
  });

  it("data.reserves.assetA.code is USDC for pool-usdc-xlm", async () => {
    const res = await request(app).get("/defi/pools/pool-usdc-xlm");

    expect(res.status).toBe(200);
    expect(res.body.data.reserves.assetA.code).toBe("USDC");
  });
});
