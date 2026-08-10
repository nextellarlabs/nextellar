import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __resetQuoteState,
  __registerAnchor,
  __setAnchorCallSuccess,
} from "../routes/anchors.quote.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /anchors/:id/quote", () => {
  const app = buildApp();

  const validQuoteRequest = {
    sourceAsset: { code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
    destinationAsset: { code: "XLM" },
    amount: "100",
  };

  beforeEach(() => {
    __resetQuoteState();
  });

  it("returns 200 with quote data for a valid request", async () => {
    const res = await request(app)
      .post("/anchors/anchor-circle/quote")
      .send(validQuoteRequest);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.quoteId).toBeDefined();
    expect(res.body.data.anchorQuote).toBeDefined();
    expect(res.body.data.sourceAsset.code).toBe("USDC");
    expect(res.body.data.destinationAsset.code).toBe("XLM");
    expect(res.body.data.amount).toBe("100");
  });

  it("returns 502 ANCHOR_ERROR when anchor call fails", async () => {
    __setAnchorCallSuccess(false);

    const res = await request(app)
      .post("/anchors/anchor-circle/quote")
      .send(validQuoteRequest);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("ANCHOR_ERROR");
    __setAnchorCallSuccess(undefined);
  });

  it("returns 400 INVALID_ANCHOR_ID for unknown anchor", async () => {
    const res = await request(app)
      .post("/anchors/unknown-anchor/quote")
      .send(validQuoteRequest);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("ANCHOR_ERROR");
  });

  it("returns 400 INVALID_SOURCE_ASSET when sourceAsset is missing", async () => {
    const res = await request(app)
      .post("/anchors/anchor-circle/quote")
      .send({
        destinationAsset: { code: "XLM" },
        amount: "100",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE_ASSET");
  });

  it("returns 400 INVALID_SOURCE_ASSET when sourceAsset.code is missing", async () => {
    const res = await request(app)
      .post("/anchors/anchor-circle/quote")
      .send({
        sourceAsset: { issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
        destinationAsset: { code: "XLM" },
        amount: "100",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SOURCE_ASSET");
  });

  it("returns 400 INVALID_DESTINATION_ASSET when destinationAsset is missing", async () => {
    const res = await request(app)
      .post("/anchors/anchor-circle/quote")
      .send({
        sourceAsset: { code: "USDC" },
        amount: "100",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DESTINATION_ASSET");
  });

  it("returns 400 INVALID_DESTINATION_ASSET when destinationAsset.code is missing", async () => {
    const res = await request(app)
      .post("/anchors/anchor-circle/quote")
      .send({
        sourceAsset: { code: "USDC" },
        destinationAsset: {},
        amount: "100",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DESTINATION_ASSET");
  });

  it("returns 400 INVALID_AMOUNT when amount is missing", async () => {
    const res = await request(app)
      .post("/anchors/anchor-circle/quote")
      .send({
        sourceAsset: { code: "USDC" },
        destinationAsset: { code: "XLM" },
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 INVALID_AMOUNT when amount is zero", async () => {
    const res = await request(app)
      .post("/anchors/anchor-circle/quote")
      .send({
        ...validQuoteRequest,
        amount: "0",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 INVALID_AMOUNT when amount is negative", async () => {
    const res = await request(app)
      .post("/anchors/anchor-circle/quote")
      .send({
        ...validQuoteRequest,
        amount: "-50",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns unique quoteId for successive requests", async () => {
    const res1 = await request(app)
      .post("/anchors/anchor-circle/quote")
      .send(validQuoteRequest);
    const res2 = await request(app)
      .post("/anchors/anchor-circle/quote")
      .send(validQuoteRequest);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.data.quoteId).not.toBe(res2.body.data.quoteId);
  });

  it("returns anchorQuote with verbatim payload from anchor", async () => {
    __registerAnchor("test-anchor", { multiplier: 1, fee: "0.25" });

    const res = await request(app)
      .post("/anchors/test-anchor/quote")
      .send(validQuoteRequest);

    expect(res.status).toBe(200);
    expect(res.body.data.anchorQuote).toHaveProperty("price");
    expect(res.body.data.anchorQuote).toHaveProperty("fee");
    expect(res.body.data.anchorQuote.fee).toBe("0.25");
  });

  it("response data has the expected shape", async () => {
    const res = await request(app)
      .post("/anchors/anchor-circle/quote")
      .send(validQuoteRequest);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("quoteId");
    expect(res.body.data).toHaveProperty("anchorQuote");
    expect(res.body.data).toHaveProperty("sourceAsset");
    expect(res.body.data).toHaveProperty("destinationAsset");
    expect(res.body.data).toHaveProperty("amount");
    expect(res.body.data).toHaveProperty("price");
    expect(res.body.data).toHaveProperty("expiresAt");
  });
});