import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import cardsIssueRouter, {
  __resetCardStore,
  __setCompliance,
  __getCard,
} from "../routes/cards.issue.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cardsIssueRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /cards", () => {
  const app = buildApp();

  const authHeader = { "x-user-id": "user-001" };

  const validBody = {
    fundingWalletId: "wallet-abc",
    currency: "USDC",
    spendLimitAmount: "500.00",
  };

  beforeEach(() => {
    __resetCardStore();
  });

  it("returns 201 with masked card details on a successful issuance", async () => {
    const res = await request(app).post("/cards").set(authHeader).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("cardId");
    expect(res.body.data.maskedNumber).toMatch(/^\*{4}-\*{4}-\*{4}-\d{4}$/);
    expect(res.body.data.currency).toBe("USDC");
    expect(res.body.data.spendLimitAmount).toBe("500.00");
    expect(typeof res.body.data.issuedAt).toBe("string");
  });

  it("does not expose the full card number in the response", async () => {
    const res = await request(app).post("/cards").set(authHeader).send(validBody);

    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/\d{16}/);
  });

  it("stores the card record internally after issuance", async () => {
    const res = await request(app).post("/cards").set(authHeader).send(validBody);

    expect(res.status).toBe(201);
    const { cardId } = res.body.data;
    const stored = __getCard(cardId);

    expect(stored).toBeDefined();
    expect(stored?.userId).toBe("user-001");
    expect(stored?.fundingWalletId).toBe(validBody.fundingWalletId);
  });

  it("returns 403 INELIGIBLE when the user is not eligible", async () => {
    __setCompliance("user-001", { kycPassed: true, eligible: false });

    const res = await request(app).post("/cards").set(authHeader).send(validBody);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("INELIGIBLE");
  });

  it("returns 403 KYC_REQUIRED when KYC has not been completed", async () => {
    __setCompliance("user-001", { kycPassed: false, eligible: true });

    const res = await request(app).post("/cards").set(authHeader).send(validBody);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("KYC_REQUIRED");
  });

  it("returns 403 KYC_REQUIRED when both KYC and eligibility are false (KYC checked first)", async () => {
    __setCompliance("user-001", { kycPassed: false, eligible: false });

    const res = await request(app).post("/cards").set(authHeader).send(validBody);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("KYC_REQUIRED");
  });

  it("returns 401 UNAUTHORIZED when x-user-id header is missing", async () => {
    const res = await request(app).post("/cards").send(validBody);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 INVALID_WALLET_ID when fundingWalletId is missing", async () => {
    const res = await request(app)
      .post("/cards")
      .set(authHeader)
      .send({ currency: "USDC", spendLimitAmount: "100" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_WALLET_ID");
  });

  it("returns 400 INVALID_CURRENCY when currency is missing", async () => {
    const res = await request(app)
      .post("/cards")
      .set(authHeader)
      .send({ fundingWalletId: "wallet-abc", spendLimitAmount: "100" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CURRENCY");
  });

  it("returns 400 UNSUPPORTED_CURRENCY for an unknown currency", async () => {
    const res = await request(app)
      .post("/cards")
      .set(authHeader)
      .send({ ...validBody, currency: "EXOTIC" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UNSUPPORTED_CURRENCY");
  });

  it("accepts currency in lowercase (normalises to uppercase)", async () => {
    const res = await request(app)
      .post("/cards")
      .set(authHeader)
      .send({ ...validBody, currency: "usdc" });

    expect(res.status).toBe(201);
    expect(res.body.data.currency).toBe("USDC");
  });

  it("returns 400 INVALID_SPEND_LIMIT when spendLimitAmount is missing", async () => {
    const res = await request(app)
      .post("/cards")
      .set(authHeader)
      .send({ fundingWalletId: "wallet-abc", currency: "USDC" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SPEND_LIMIT");
  });

  it("returns 400 INVALID_SPEND_LIMIT when spendLimitAmount is zero", async () => {
    const res = await request(app)
      .post("/cards")
      .set(authHeader)
      .send({ ...validBody, spendLimitAmount: "0" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SPEND_LIMIT");
  });

  it("returns 400 INVALID_SPEND_LIMIT when spendLimitAmount is negative", async () => {
    const res = await request(app)
      .post("/cards")
      .set(authHeader)
      .send({ ...validBody, spendLimitAmount: "-50" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SPEND_LIMIT");
  });

  it("response data has the expected shape", async () => {
    const res = await request(app).post("/cards").set(authHeader).send(validBody);

    expect(res.status).toBe(201);
    const data = res.body.data;
    expect(data).toHaveProperty("cardId");
    expect(data).toHaveProperty("maskedNumber");
    expect(data).toHaveProperty("expiryMonth");
    expect(data).toHaveProperty("expiryYear");
    expect(data).toHaveProperty("currency");
    expect(data).toHaveProperty("spendLimitAmount");
    expect(data).toHaveProperty("issuedAt");
  });

  it("issues unique cardIds for two successive requests", async () => {
    const r1 = await request(app).post("/cards").set(authHeader).send(validBody);
    const r2 = await request(app).post("/cards").set(authHeader).send(validBody);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.data.cardId).not.toBe(r2.body.data.cardId);
  });
});
