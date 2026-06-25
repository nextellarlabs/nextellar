import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import poolsListRouter, {
  __resetPoolsListCache,
  __seedPoolsList,
} from "../routes/defi.pools.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(poolsListRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const samplePools = [
  {
    id: "pool-usdc-xlm",
    assetA: { code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", amount: "1000000.00" },
    assetB: { code: "XLM", issuer: "native", amount: "50000000.00" },
    totalShares: "7071067.81",
    apyEstimate: "5.04",
  },
  {
    id: "pool-btc-xlm",
    assetA: { code: "BTC", issuer: "GDPJALI4AZKUU2W426U5WKMAT6CN3AJRPIIRYR2YM54TL2GDWO5O2MZM", amount: "10.00" },
    assetB: { code: "XLM", issuer: "native", amount: "2000000.00" },
    totalShares: "4472.13",
    apyEstimate: "7.20",
  },
  {
    id: "pool-usdt-xlm",
    assetA: { code: "USDT", issuer: "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53NMYVOZ3A7EKV68", amount: "500000.00" },
    assetB: { code: "XLM", issuer: "native", amount: "25000000.00" },
    totalShares: "3535533.90",
    apyEstimate: "4.80",
  },
];

describe("GET /defi/pools", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetPoolsListCache();
  });

  it("returns 200 with all pools when no filter is applied", async () => {
    const res = await request(app).get("/defi/pools");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.pools.length).toBe(3);
    expect(res.body.pagination.total).toBe(3);
  });

  it("filters pools by assetA code (uppercase)", async () => {
    const res = await request(app).get("/defi/pools?asset=USDC");

    expect(res.status).toBe(200);
    expect(res.body.data.pools.length).toBe(1);
    expect(res.body.data.pools[0].id).toBe("pool-usdc-xlm");
    expect(res.body.pagination.total).toBe(1);
  });

  it("filters pools by assetB code (XLM appears in all three pools)", async () => {
    const res = await request(app).get("/defi/pools?asset=XLM");

    expect(res.status).toBe(200);
    expect(res.body.data.pools.length).toBe(3);
  });

  it("asset filter is case-insensitive", async () => {
    const upper = await request(app).get("/defi/pools?asset=USDC");
    const lower = await request(app).get("/defi/pools?asset=usdc");

    expect(upper.status).toBe(200);
    expect(lower.status).toBe(200);
    expect(lower.body.data.pools.length).toBe(upper.body.data.pools.length);
    expect(lower.body.data.pools[0].id).toBe(upper.body.data.pools[0].id);
  });

  it("returns empty pools array and total 0 when filter matches nothing", async () => {
    const res = await request(app).get("/defi/pools?asset=UNKNOWN");

    expect(res.status).toBe(200);
    expect(res.body.data.pools).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it("paginates results correctly", async () => {
    const res = await request(app).get("/defi/pools?page=2&limit=1");

    expect(res.status).toBe(200);
    expect(res.body.data.pools.length).toBe(1);
    expect(res.body.pagination.page).toBe(2);
    expect(res.body.pagination.limit).toBe(1);
    expect(res.body.pagination.total).toBe(3);
    expect(res.body.pagination.totalPages).toBe(3);
  });

  it("returns fromCache: false on first call", async () => {
    const res = await request(app).get("/defi/pools");

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(false);
  });

  it("returns fromCache: true on a second call within the TTL window", async () => {
    await request(app).get("/defi/pools");
    const res = await request(app).get("/defi/pools");

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(true);
  });

  it("returns 400 INVALID_PAGINATION when page is 0", async () => {
    const res = await request(app).get("/defi/pools?page=0");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAGINATION");
  });

  it("returns 400 INVALID_PAGINATION when limit is 0", async () => {
    const res = await request(app).get("/defi/pools?limit=0");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAGINATION");
  });

  it("returns 400 INVALID_PAGINATION when limit exceeds MAX_LIMIT", async () => {
    const res = await request(app).get("/defi/pools?limit=101");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAGINATION");
  });

  it("response has correct shape with all required fields", async () => {
    const res = await request(app).get("/defi/pools");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("data");
    expect(res.body.data).toHaveProperty("pools");
    expect(res.body.data).toHaveProperty("fromCache");
    expect(res.body).toHaveProperty("pagination");
    expect(res.body.pagination).toHaveProperty("page");
    expect(res.body.pagination).toHaveProperty("limit");
    expect(res.body.pagination).toHaveProperty("total");
    expect(res.body.pagination).toHaveProperty("totalPages");
  });

  it("reflects seeded pools after __seedPoolsList", async () => {
    __seedPoolsList(samplePools.slice(0, 1));

    const res = await request(app).get("/defi/pools");

    expect(res.status).toBe(200);
    expect(res.body.data.pools.length).toBe(1);
    expect(res.body.data.pools[0].id).toBe("pool-usdc-xlm");
  });
});
