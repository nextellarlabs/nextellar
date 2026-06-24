import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import stellarOrderbookGetRouter from "../routes/stellar.orderbook.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(stellarOrderbookGetRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /stellar/orderbook", () => {
  const app = buildApp();

  const validQuery = {
    buyingAssetCode: "USD",
    buyingAssetIssuer: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG",
    sellingAssetCode: "XLM",
  };

  it("returns order book with valid asset pair", async () => {
    const res = await request(app).get("/stellar/orderbook").query(validQuery);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("bids");
    expect(res.body.data).toHaveProperty("asks");
    expect(res.body.data).toHaveProperty("base");
    expect(res.body.data).toHaveProperty("counter");
  });

  it("returns order book with correct asset information", async () => {
    const res = await request(app).get("/stellar/orderbook").query(validQuery);

    expect(res.status).toBe(200);
    expect(res.body.data.base.asset_code).toBe("XLM");
    expect(res.body.data.counter.asset_code).toBe("USD");
    expect(res.body.data.counter.asset_issuer).toBe(
      "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG",
    );
  });

  it("returns bids and asks in order book", async () => {
    const res = await request(app).get("/stellar/orderbook").query(validQuery);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.bids)).toBe(true);
    expect(Array.isArray(res.body.data.asks)).toBe(true);
    expect(res.body.data.bids.length).toBeGreaterThan(0);
    expect(res.body.data.asks.length).toBeGreaterThan(0);
  });

  it("returns 400 when buyingAssetCode is missing", async () => {
    const query = { ...validQuery };
    delete query.buyingAssetCode;
    const res = await request(app).get("/stellar/orderbook").query(query);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_BUYING_ASSET_CODE");
  });

  it("returns 400 when sellingAssetCode is missing", async () => {
    const query = { ...validQuery };
    delete query.sellingAssetCode;
    const res = await request(app).get("/stellar/orderbook").query(query);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SELLING_ASSET_CODE");
  });

  it("returns 400 when buying and selling assets are the same", async () => {
    const res = await request(app).get("/stellar/orderbook").query({
      buyingAssetCode: "USD",
      buyingAssetIssuer: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG",
      sellingAssetCode: "USD",
      sellingAssetIssuer: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ASSET_PAIR");
  });

  it("respects the limit parameter", async () => {
    const res = await request(app).get("/stellar/orderbook").query({
      ...validQuery,
      limit: "1",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.bids.length).toBeLessThanOrEqual(1);
    expect(res.body.data.asks.length).toBeLessThanOrEqual(1);
  });

  it("applies default limit when not provided", async () => {
    const res = await request(app).get("/stellar/orderbook").query(validQuery);

    expect(res.status).toBe(200);
    expect(res.body.data.bids.length).toBeLessThanOrEqual(20);
    expect(res.body.data.asks.length).toBeLessThanOrEqual(20);
  });

  it("caps limit to maximum of 200", async () => {
    const res = await request(app).get("/stellar/orderbook").query({
      ...validQuery,
      limit: "500",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.bids.length).toBeLessThanOrEqual(200);
    expect(res.body.data.asks.length).toBeLessThanOrEqual(200);
  });

  it("returns 400 when limit is not a positive number", async () => {
    const res = await request(app).get("/stellar/orderbook").query({
      ...validQuery,
      limit: "-5",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_LIMIT");
  });

  it("handles native XLM asset", async () => {
    const res = await request(app).get("/stellar/orderbook").query({
      buyingAssetCode: "native",
      sellingAssetCode: "USD",
      sellingAssetIssuer: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.base.asset_type).toBe("credit_alphanum12");
    expect(res.body.data.counter.asset_type).toBe("native");
  });
});
