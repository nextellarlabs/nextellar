import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import marketDepthRouter, {
  __resetDepthStore,
  __seedOrderBook,
  __seedDepthCache,
} from "../routes/defi.market.depth.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(marketDepthRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const PAIR = "XLM:USDC-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const normalBook = {
  bids: [
    { price: "0.0910", amount: "5000" },
    { price: "0.0905", amount: "8000" },
    { price: "0.0900", amount: "12000" },
  ],
  asks: [
    { price: "0.0915", amount: "4500" },
    { price: "0.0920", amount: "7500" },
  ],
};

const thinBook = {
  bids: [{ price: "0.0800", amount: "10" }],
  asks: [{ price: "0.1000", amount: "5" }],
};

describe("GET /defi/market/:pair/depth", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetDepthStore();
  });

  it("returns 200 with bids and asks for a normal order book", async () => {
    __seedOrderBook(PAIR, normalBook);

    const res = await request(app).get(`/defi/market/${encodeURIComponent(PAIR)}/depth`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.bids)).toBe(true);
    expect(Array.isArray(res.body.data.asks)).toBe(true);
    expect(res.body.data.bids.length).toBe(3);
    expect(res.body.data.asks.length).toBe(2);
    expect(res.body.data.fromCache).toBe(false);
  });

  it("returns correct spread for a normal book", async () => {
    __seedOrderBook(PAIR, normalBook);

    const res = await request(app).get(`/defi/market/${encodeURIComponent(PAIR)}/depth`);

    expect(res.status).toBe(200);
    // bestAsk 0.0915 - bestBid 0.0910 = 0.0005
    expect(parseFloat(res.body.data.spread)).toBeCloseTo(0.0005, 4);
  });

  it("returns wide spread for a thin book", async () => {
    __seedOrderBook(PAIR, thinBook);

    const res = await request(app).get(`/defi/market/${encodeURIComponent(PAIR)}/depth`);

    expect(res.status).toBe(200);
    expect(parseFloat(res.body.data.spread)).toBeGreaterThan(0.01);
  });

  it("respects the depth cap parameter", async () => {
    __seedOrderBook(PAIR, normalBook);

    const res = await request(app).get(`/defi/market/${encodeURIComponent(PAIR)}/depth?depth=1`);

    expect(res.status).toBe(200);
    expect(res.body.data.bids.length).toBe(1);
    expect(res.body.data.asks.length).toBe(1);
  });

  it("returns 400 DEPTH_EXCEEDS_MAX when depth exceeds 100", async () => {
    __seedOrderBook(PAIR, normalBook);

    const res = await request(app).get(`/defi/market/${encodeURIComponent(PAIR)}/depth?depth=101`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("DEPTH_EXCEEDS_MAX");
  });

  it("returns 400 INVALID_DEPTH for a non-positive depth", async () => {
    __seedOrderBook(PAIR, normalBook);

    const res = await request(app).get(`/defi/market/${encodeURIComponent(PAIR)}/depth?depth=0`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DEPTH");
  });

  it("returns 400 INVALID_PAIR_FORMAT for a badly formatted pair", async () => {
    const res = await request(app).get("/defi/market/invalid--pair!!/depth");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAIR_FORMAT");
  });

  it("returns 400 INVALID_PAIR_FORMAT for lowercase pair", async () => {
    const res = await request(app).get("/defi/market/xlm:usdc/depth");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAIR_FORMAT");
  });

  it("returns 404 UNKNOWN_PAIR when no order book exists for the pair", async () => {
    const res = await request(app).get("/defi/market/FOO:BAR/depth");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("UNKNOWN_PAIR");
  });

  it("returns fromCache: true on a second identical request within TTL window", async () => {
    __seedOrderBook(PAIR, normalBook);

    await request(app).get(`/defi/market/${encodeURIComponent(PAIR)}/depth`);
    const res = await request(app).get(`/defi/market/${encodeURIComponent(PAIR)}/depth`);

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(true);
  });

  it("returns seeded cache entry as a cache hit", async () => {
    const seedData = {
      pair: PAIR,
      bids: [{ price: "0.09", amount: "100", total: "9.0000000" }],
      asks: [{ price: "0.10", amount: "100", total: "10.0000000" }],
      spread: "0.0100000",
      fromCache: false,
    };
    __seedDepthCache(`${PAIR}:20`, seedData);

    const res = await request(app).get(`/defi/market/${encodeURIComponent(PAIR)}/depth`);

    expect(res.status).toBe(200);
    expect(res.body.data.fromCache).toBe(true);
    expect(res.body.data.spread).toBe("0.0100000");
  });

  it("each order level has price, amount, and total fields", async () => {
    __seedOrderBook(PAIR, normalBook);

    const res = await request(app).get(`/defi/market/${encodeURIComponent(PAIR)}/depth`);

    expect(res.status).toBe(200);
    [...res.body.data.bids, ...res.body.data.asks].forEach((level: Record<string, unknown>) => {
      expect(level).toHaveProperty("price");
      expect(level).toHaveProperty("amount");
      expect(level).toHaveProperty("total");
    });
  });

  it("response data has the expected top-level shape", async () => {
    __seedOrderBook(PAIR, normalBook);

    const res = await request(app).get(`/defi/market/${encodeURIComponent(PAIR)}/depth`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("pair");
    expect(res.body.data).toHaveProperty("bids");
    expect(res.body.data).toHaveProperty("asks");
    expect(res.body.data).toHaveProperty("spread");
    expect(res.body.data).toHaveProperty("fromCache");
  });
});
