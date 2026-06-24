import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import stellarOfferCreateRouter from "../routes/stellar.offer.create.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(stellarOfferCreateRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /stellar/offer/create", () => {
  const app = buildApp();

  const validSellRequest = {
    sellingAsset: { code: "USD", issuer: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG" },
    buyingAsset: { code: "XLM" },
    amount: "100",
    price: "2.5",
    offerType: "sell",
    accountId: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG",
  };

  const validBuyRequest = {
    sellingAsset: { code: "XLM" },
    buyingAsset: { code: "USD", issuer: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG" },
    amount: "250",
    price: "0.4",
    offerType: "buy",
    accountId: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG",
  };

  it("creates a sell offer with valid data", async () => {
    const res = await request(app).post("/stellar/offer/create").send(validSellRequest);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.offerType).toBe("sell");
    expect(res.body.data.amount).toBe("100");
    expect(res.body.data.price).toBe("2.5");
  });

  it("creates a buy offer with valid data", async () => {
    const res = await request(app).post("/stellar/offer/create").send(validBuyRequest);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.offerType).toBe("buy");
    expect(res.body.data.amount).toBe("250");
    expect(res.body.data.price).toBe("0.4");
  });

  it("returns 400 when sellingAsset is missing", async () => {
    const req = { ...validSellRequest };
    delete req.sellingAsset;
    const res = await request(app).post("/stellar/offer/create").send(req);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SELLING_ASSET");
  });

  it("returns 400 when buyingAsset is missing", async () => {
    const req = { ...validSellRequest };
    delete req.buyingAsset;
    const res = await request(app).post("/stellar/offer/create").send(req);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_BUYING_ASSET");
  });

  it("returns 400 when amount is missing", async () => {
    const req = { ...validSellRequest };
    delete req.amount;
    const res = await request(app).post("/stellar/offer/create").send(req);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 when amount is not a positive number", async () => {
    const res = await request(app).post("/stellar/offer/create").send({
      ...validSellRequest,
      amount: "-100",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 when price is missing", async () => {
    const req = { ...validSellRequest };
    delete req.price;
    const res = await request(app).post("/stellar/offer/create").send(req);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PRICE");
  });

  it("returns 400 when price is not a positive number", async () => {
    const res = await request(app).post("/stellar/offer/create").send({
      ...validSellRequest,
      price: "0",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PRICE");
  });

  it("returns 400 when offerType is invalid", async () => {
    const res = await request(app).post("/stellar/offer/create").send({
      ...validSellRequest,
      offerType: "invalid",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_OFFER_TYPE");
  });

  it("returns 400 when accountId is missing", async () => {
    const req = { ...validSellRequest };
    delete req.accountId;
    const res = await request(app).post("/stellar/offer/create").send(req);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ACCOUNT_ID");
  });

  it("returns 400 when accountId is not a valid Stellar public key", async () => {
    const res = await request(app).post("/stellar/offer/create").send({
      ...validSellRequest,
      accountId: "INVALID_KEY",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ACCOUNT_ID");
  });

  it("returns 400 when selling and buying assets are the same", async () => {
    const res = await request(app).post("/stellar/offer/create").send({
      sellingAsset: { code: "USD", issuer: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG" },
      buyingAsset: { code: "USD", issuer: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG" },
      amount: "100",
      price: "1",
      offerType: "sell",
      accountId: "GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQQBG5ESBWXHOMGGKJUW7E7JG",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ASSET_PAIR");
  });
});
