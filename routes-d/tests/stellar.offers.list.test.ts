import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import stellarOffersRouter, {
  __resetOffers,
  __seedOffers,
} from "../routes/stellar.offers.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(stellarOffersRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const VALID_ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

function makeOffer(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    account: VALID_ACCOUNT,
    selling: { code: "XLM" },
    buying: { code: "USDC", issuer: VALID_ACCOUNT },
    amount: "500",
    price: "0.10",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("GET /stellar/offers/:account", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetOffers();
  });

  it("returns an empty list for an account with no offers", async () => {
    const res = await request(app).get(`/stellar/offers/${VALID_ACCOUNT}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.offers).toHaveLength(0);
    expect(res.body.data.hasMore).toBe(false);
    expect(res.body.data.cursor).toBeNull();
  });

  it("returns offers for a known account", async () => {
    __seedOffers(VALID_ACCOUNT, [makeOffer("offer-1"), makeOffer("offer-2")]);

    const res = await request(app).get(`/stellar/offers/${VALID_ACCOUNT}`);

    expect(res.status).toBe(200);
    expect(res.body.data.offers).toHaveLength(2);
  });

  it("filters by selling asset", async () => {
    __seedOffers(VALID_ACCOUNT, [
      makeOffer("offer-1", { selling: { code: "XLM" } }),
      makeOffer("offer-2", { selling: { code: "EUR", issuer: VALID_ACCOUNT } }),
    ]);

    const res = await request(app)
      .get(`/stellar/offers/${VALID_ACCOUNT}`)
      .query({ selling: "EUR" });

    expect(res.status).toBe(200);
    expect(res.body.data.offers).toHaveLength(1);
    expect(res.body.data.offers[0].id).toBe("offer-2");
  });

  it("filters by buying asset", async () => {
    __seedOffers(VALID_ACCOUNT, [
      makeOffer("offer-1", { buying: { code: "USDC", issuer: VALID_ACCOUNT } }),
      makeOffer("offer-2", { buying: { code: "BTC", issuer: VALID_ACCOUNT } }),
    ]);

    const res = await request(app)
      .get(`/stellar/offers/${VALID_ACCOUNT}`)
      .query({ buying: "BTC" });

    expect(res.status).toBe(200);
    expect(res.body.data.offers).toHaveLength(1);
    expect(res.body.data.offers[0].id).toBe("offer-2");
  });

  it("paginates when there are many offers", async () => {
    const offers = Array.from({ length: 15 }, (_, i) =>
      makeOffer(`offer-${i}`),
    );
    __seedOffers(VALID_ACCOUNT, offers);

    const first = await request(app)
      .get(`/stellar/offers/${VALID_ACCOUNT}`)
      .query({ limit: "5" });

    expect(first.status).toBe(200);
    expect(first.body.data.offers).toHaveLength(5);
    expect(first.body.data.hasMore).toBe(true);
    expect(first.body.data.cursor).toBe("offer-4");

    const second = await request(app)
      .get(`/stellar/offers/${VALID_ACCOUNT}`)
      .query({ limit: "5", cursor: "offer-4" });

    expect(second.status).toBe(200);
    expect(second.body.data.offers).toHaveLength(5);
    expect(second.body.data.offers[0].id).toBe("offer-5");
    expect(second.body.data.hasMore).toBe(true);

    const third = await request(app)
      .get(`/stellar/offers/${VALID_ACCOUNT}`)
      .query({ limit: "5", cursor: "offer-9" });

    expect(third.status).toBe(200);
    expect(third.body.data.offers).toHaveLength(5);
    expect(third.body.data.hasMore).toBe(false);
    expect(third.body.data.cursor).toBeNull();
  });

  it("returns 400 for an invalid account ID", async () => {
    const res = await request(app).get("/stellar/offers/not-a-valid-account");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ACCOUNT");
  });

  it("returns 400 for an invalid cursor", async () => {
    __seedOffers(VALID_ACCOUNT, [makeOffer("offer-1")]);

    const res = await request(app)
      .get(`/stellar/offers/${VALID_ACCOUNT}`)
      .query({ cursor: "nonexistent" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CURSOR");
  });
});
