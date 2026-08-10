import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __resetData,
  __seedListing,
  __seedBalance,
  __getListing,
} from "../routes/listings.buy.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const BASE_LISTING = {
  id: "listing-1",
  price: 100,
  seller: "seller-1",
  escrowAccount: "escrow-1",
  active: true,
};

describe("POST /listings/:id/buy", () => {
  const app = buildApp();

  beforeEach(() => {
    // Ensure the settlement webhook is a no-op in tests.
    delete process.env.WEBHOOK_URL;
    __resetData();
    __seedListing(BASE_LISTING);
  });

  it("succeeds when the listing is active and the buyer has sufficient funds", async () => {
    __seedBalance("buyer-1", 500);
    __seedBalance("seller-1", 0);

    const res = await request(app)
      .post("/listings/listing-1/buy")
      .set("x-buyer-id", "buyer-1")
      .send({ buyerId: "buyer-1" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      listingId: "listing-1",
      buyerId: "buyer-1",
      price: 100,
    });
    expect(res.body.data.soldAt).toBeDefined();

    // The listing is marked as sold for the buyer.
    const listing = __getListing("listing-1");
    expect(listing?.active).toBe(false);
    expect(listing?.buyerId).toBe("buyer-1");
    expect(listing?.soldAt).toBeDefined();
  });

  it("returns 409 when the listing is already sold", async () => {
    __seedListing({ ...BASE_LISTING, id: "listing-2", active: false });
    __seedBalance("buyer-1", 500);

    const res = await request(app)
      .post("/listings/listing-2/buy")
      .set("x-buyer-id", "buyer-1")
      .send({ buyerId: "buyer-1" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_SOLD");
  });

  it("returns 422 when the buyer has insufficient funds", async () => {
    __seedBalance("buyer-1", 50); // less than the 100 listing price

    const res = await request(app)
      .post("/listings/listing-1/buy")
      .set("x-buyer-id", "buyer-1")
      .send({ buyerId: "buyer-1" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INSUFFICIENT_FUNDS");
  });

  it("returns 404 when the listing does not exist", async () => {
    __seedBalance("buyer-1", 500);

    const res = await request(app)
      .post("/listings/unknown/buy")
      .set("x-buyer-id", "buyer-1")
      .send({ buyerId: "buyer-1" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 when buyerId is missing", async () => {
    const res = await request(app)
      .post("/listings/listing-1/buy")
      .set("x-buyer-id", "buyer-1")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_BUYER_ID");
  });

  it("returns 401 when the auth header is missing", async () => {
    const res = await request(app)
      .post("/listings/listing-1/buy")
      .send({ buyerId: "buyer-1" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("MISSING_AUTH");
  });

  it("returns 403 when buyerId does not match the authenticated caller", async () => {
    const res = await request(app)
      .post("/listings/listing-1/buy")
      .set("x-buyer-id", "attacker-1")
      .send({ buyerId: "buyer-1" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("UNAUTHORIZED_BUYER");
  });
});
