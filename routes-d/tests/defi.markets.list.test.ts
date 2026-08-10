import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import marketsListRouter, {
  __resetMarketsListCache,
  __seedMarketsList,
} from "../routes/defi.markets.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(marketsListRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const sampleMarkets = [
  {
    id: "USDC-XLM",
    baseAsset: { code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
    counterAsset: { code: "XLM", issuer: "native" },
    baseVolume24h: "2500000.00",
    counterVolume24h: "125000000.00",
    tradeCount24h: 4320,
    open: "0.0200",
    high: "0.0210",
    low: "0.0195",
    close: "0.0205",
    change24h: "2.50",
  },
  {
    id: "BTC-XLM",
    baseAsset: { code: "BTC", issuer: "GDPJALI4AZKUU2W426U5WKMAT6CN3AJRPIIRYR2YM54TL2GDWO5O2MZM" },
    counterAsset: { code: "XLM", issuer: "native" },
    baseVolume24h: "85.00",
    counterVolume24h: "17000000.00",
    tradeCount24h: 890,
    open: "190000.0000",
    high: "205000.0000",
    low: "188000.0000",
    close: "200000.0000",
    change24h: "5.26",
  },
];

describe("GET /defi/markets", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetMarketsListCache();
  });

  it("returns 200 with all markets when no filter is applied", async () => {
    const res = await request(app).get("/defi/markets");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.markets)).toBe(true);
    expect(res.body.data.markets.length).toBeGreaterThan(0);
  });

  it("returns markets ranked by baseVolume24h descending", async () => {
    const res = await request(app).get("/defi/markets");

    expect(res.status).toBe(200);
    const markets = res.body.data.markets;
    expect(markets.length).toBeGreaterThan(1);

    for (let i = 0; i < markets.length - 1; i++) {
      expect(parseFloat(markets[i].baseVolume24h)).toBeGreaterThanOrEqual(
        parseFloat(markets[i + 1].baseVolume24h),
      );
    }
  });

  it("the highest-volume market is listed first", async () => {
    __seedMarketsList(sampleMarkets);

    const res = await request(app).get("/defi/markets");

    expect(res.status).toBe(200);
    expect(res.body.data.markets[0].id).toBe("USDC-XLM");
  });

  it("filters markets by base asset code (case-insensitive)", async () => {
    const res = await request(app).get("/defi/markets?asset=usdc");

    expect(res.status).toBe(200);
    const markets = res.body.data.markets;
    expect(markets.length).toBeGreaterThan(0);
    markets.forEach((m: { baseAsset: { code: string }; counterAsset: { code: string } }) => {
      const matchesBase = m.baseAsset.code.toUpperCase() === "USDC";
      const matchesCounter = m.counterAsset.code.toUpperCase() === "USDC";
      expect(matchesBase || matchesCounter).toBe(true);
    });
  });

  it("filters markets by counter asset code (XLM appears in all default markets)", async () => {
    const res = await request(app).get("/defi/markets?asset=XLM");

    expect(res.status).toBe(200);
    expect(res.body.data.markets.length).toBe(4);
  });

  it("returns empty array when filter matches nothing", async () => {
    const res = await request(app).get("/defi/markets?asset=UNKNOWN");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.markets).toEqual([]);
  });

  it("returns fromCache: false on the first call", async () => {
    const res = await request(app).get("/defi/markets");

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(false);
  });

  it("returns fromCache: true on a second call within the TTL window", async () => {
    await request(app).get("/defi/markets");
    const res = await request(app).get("/defi/markets");

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(true);
  });

  it("ranking is stable across two identical requests", async () => {
    const first = await request(app).get("/defi/markets");
    const second = await request(app).get("/defi/markets");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const ids1 = first.body.data.markets.map((m: { id: string }) => m.id);
    const ids2 = second.body.data.markets.map((m: { id: string }) => m.id);
    expect(ids1).toEqual(ids2);
  });

  it("reflects seeded markets after __seedMarketsList", async () => {
    __seedMarketsList(sampleMarkets);

    const res = await request(app).get("/defi/markets");

    expect(res.status).toBe(200);
    expect(res.body.data.markets.length).toBe(2);
  });

  it("each market has the expected shape", async () => {
    const res = await request(app).get("/defi/markets");

    expect(res.status).toBe(200);
    const market = res.body.data.markets[0];
    expect(market).toHaveProperty("id");
    expect(market).toHaveProperty("baseAsset");
    expect(market.baseAsset).toHaveProperty("code");
    expect(market.baseAsset).toHaveProperty("issuer");
    expect(market).toHaveProperty("counterAsset");
    expect(market).toHaveProperty("baseVolume24h");
    expect(market).toHaveProperty("counterVolume24h");
    expect(market).toHaveProperty("tradeCount24h");
    expect(market).toHaveProperty("open");
    expect(market).toHaveProperty("high");
    expect(market).toHaveProperty("low");
    expect(market).toHaveProperty("close");
    expect(market).toHaveProperty("change24h");
  });

  it("empty store returns empty array", async () => {
    __seedMarketsList([]);

    const res = await request(app).get("/defi/markets");

    expect(res.status).toBe(200);
    expect(res.body.data.markets).toEqual([]);
  });
});
