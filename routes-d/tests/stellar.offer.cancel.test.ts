import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import cancelRouter, {
  __resetOffers,
  __seedOffer,
  __getOffers,
} from "../routes/stellar.offer.cancel.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cancelRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const ACCOUNT_A = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const ACCOUNT_B = "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG";

const seedOffer = {
  id: "12345",
  accountId: ACCOUNT_A,
  sellingAsset: { code: "XLM" },
  buyingAsset: { code: "USDC", issuer: ACCOUNT_A },
  price: "1.5",
};

describe("POST /stellar/offer/cancel", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetOffers();
  });

  it("returns 200 with a valid XDR envelope when the caller owns the offer", async () => {
    __seedOffer(seedOffer);

    const res = await request(app)
      .post("/stellar/offer/cancel")
      .send({ offerId: "12345", accountId: ACCOUNT_A });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.envelope).toBe("string");
    expect(res.body.data.envelope.length).toBeGreaterThan(0);
    expect(res.body.data.offerId).toBe("12345");
    expect(res.body.data.networkPassphrase).toBeDefined();
  });

  it("returns 403 OFFER_NOT_OWNED when the caller does not own the offer", async () => {
    __seedOffer(seedOffer);

    const res = await request(app)
      .post("/stellar/offer/cancel")
      .send({ offerId: "12345", accountId: ACCOUNT_B });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("OFFER_NOT_OWNED");
  });

  it("returns 404 OFFER_NOT_FOUND for an unknown offerId", async () => {
    const res = await request(app)
      .post("/stellar/offer/cancel")
      .send({ offerId: "99999", accountId: ACCOUNT_A });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("OFFER_NOT_FOUND");
  });

  it("returns 400 MISSING_OFFER_ID when offerId is absent", async () => {
    const res = await request(app)
      .post("/stellar/offer/cancel")
      .send({ accountId: ACCOUNT_A });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_OFFER_ID");
  });

  it("returns 400 MISSING_OFFER_ID when offerId is '0'", async () => {
    const res = await request(app)
      .post("/stellar/offer/cancel")
      .send({ offerId: "0", accountId: ACCOUNT_A });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_OFFER_ID");
  });

  it("returns 400 MISSING_OFFER_ID when offerId is non-numeric", async () => {
    const res = await request(app)
      .post("/stellar/offer/cancel")
      .send({ offerId: "abc", accountId: ACCOUNT_A });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_OFFER_ID");
  });

  it("returns 400 INVALID_ACCOUNT_ID when accountId is not a valid Stellar key", async () => {
    __seedOffer(seedOffer);

    const res = await request(app)
      .post("/stellar/offer/cancel")
      .send({ offerId: "12345", accountId: "notakey" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ACCOUNT_ID");
  });

  it("exposes the offers store via __getOffers for test assertions", () => {
    __seedOffer(seedOffer);
    expect(__getOffers().get("12345")).toEqual(seedOffer);
  });
});
