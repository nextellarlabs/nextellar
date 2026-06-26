import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __resetCardStore,
  __seedCard,
  __setCompliance,
  __setUserTier,
  __getCard,
  __getAuditEvents,
} from "../routes/cards.limit.set.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /cards/:id/limit", () => {
  const app = buildApp();
  const userId = "user-001";
  const authHeader = { "x-user-id": userId };

  const ACTIVE_CARD = {
    cardId: "card-001",
    userId,
    status: "active" as const,
    maskedNumber: "****-****-****-1234",
    expiryMonth: "12",
    expiryYear: "2027",
    currency: "USDC",
    spendLimitAmount: "500.00",
    issuedAt: "2024-01-01T00:00:00Z",
  };

  const OTHER_USER_CARD = {
    cardId: "card-002",
    userId: "user-other",
    status: "active" as const,
    maskedNumber: "****-****-****-5678",
    expiryMonth: "06",
    expiryYear: "2026",
    currency: "USDC",
    spendLimitAmount: "300.00",
    issuedAt: "2024-01-01T00:00:00Z",
  };

  beforeEach(() => {
    __resetCardStore();
    __seedCard(ACTIVE_CARD);
    __seedCard(OTHER_USER_CARD);
  });

  it("sets spend limit on a card and returns 200", async () => {
    const res = await request(app)
      .post("/cards/card-001/limit")
      .set(authHeader)
      .send({ spendLimitAmount: "750.00" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.spendLimitAmount).toBe("750.00");
    expect(res.body.data.cardId).toBe("card-001");
    expect(res.body.data.updatedAt).toBeDefined();
  });

  it("persists the limit in storage", async () => {
    await request(app)
      .post("/cards/card-001/limit")
      .set(authHeader)
      .send({ spendLimitAmount: "1000.00" });
    const stored = __getCard("card-001")!;
    expect(stored.spendLimitAmount).toBe("1000.00");
  });

  it("emits an audit event on limit change", async () => {
    await request(app)
      .post("/cards/card-001/limit")
      .set(authHeader)
      .send({ spendLimitAmount: "2000.00" });
    const events = __getAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("limit_set");
    expect(events[0].cardId).toBe("card-001");
    expect(events[0].performedBy).toBe(userId);
    expect(events[0].limit).toBe("2000.00");
  });

  it("returns 403 FORBIDDEN when user is not card owner", async () => {
    const res = await request(app)
      .post("/cards/card-002/limit")
      .set(authHeader)
      .send({ spendLimitAmount: "500.00" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 401 when x-user-id header is missing", async () => {
    const res = await request(app)
      .post("/cards/card-001/limit")
      .send({ spendLimitAmount: "500.00" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 INVALID_SPEND_LIMIT when spendLimitAmount is missing", async () => {
    const res = await request(app)
      .post("/cards/card-001/limit")
      .set(authHeader)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SPEND_LIMIT");
  });

  it("returns 400 INVALID_SPEND_LIMIT when spendLimitAmount is not a string", async () => {
    const res = await request(app)
      .post("/cards/card-001/limit")
      .set(authHeader)
      .send({ spendLimitAmount: 500 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SPEND_LIMIT");
  });

  it("returns 400 INVALID_SPEND_LIMIT when spendLimitAmount is zero", async () => {
    const res = await request(app)
      .post("/cards/card-001/limit")
      .set(authHeader)
      .send({ spendLimitAmount: "0" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SPEND_LIMIT");
  });

  it("returns 400 INVALID_SPEND_LIMIT when spendLimitAmount is negative", async () => {
    const res = await request(app)
      .post("/cards/card-001/limit")
      .set(authHeader)
      .send({ spendLimitAmount: "-100" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_SPEND_LIMIT");
  });

  it("returns 403 TIER_LIMIT_EXCEEDED when exceeding default bronze tier limit", async () => {
    const res = await request(app)
      .post("/cards/card-001/limit")
      .set(authHeader)
      .send({ spendLimitAmount: "2000.00" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("TIER_LIMIT_EXCEEDED");
  });

  it("allows limit up to silver tier", async () => {
    __resetCardStore();
    __setUserTier(userId, "silver");
    __seedCard(ACTIVE_CARD);

    const res = await request(app)
      .post("/cards/card-001/limit")
      .set(authHeader)
      .send({ spendLimitAmount: "4500.00" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 403 TIER_LIMIT_EXCEEDED when exceeding silver tier limit", async () => {
    __resetCardStore();
    __setUserTier(userId, "silver");
    __seedCard(ACTIVE_CARD);

    const res = await request(app)
      .post("/cards/card-001/limit")
      .set(authHeader)
      .send({ spendLimitAmount: "6000.00" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("TIER_LIMIT_EXCEEDED");
  });

  it("returns 403 LIMIT_EXCEEDED when exceeding compliance limit", async () => {
    __resetCardStore();
    __setCompliance(userId, { kycPassed: true, eligible: true, maxSpendLimit: "500.00" });
    __seedCard(ACTIVE_CARD);

    const res = await request(app)
      .post("/cards/card-001/limit")
      .set(authHeader)
      .send({ spendLimitAmount: "750.00" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("LIMIT_EXCEEDED");
  });

  it("compliance limit takes precedence over tier limit", async () => {
    __resetCardStore();
    __setUserTier(userId, "gold");
    __setCompliance(userId, { kycPassed: true, eligible: true, maxSpendLimit: "100.00" });
    __seedCard(ACTIVE_CARD);

    const res = await request(app)
      .post("/cards/card-001/limit")
      .set(authHeader)
      .send({ spendLimitAmount: "200.00" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("LIMIT_EXCEEDED");
  });

  it("returns 404 CARD_NOT_FOUND for unknown card", async () => {
    const res = await request(app)
      .post("/cards/nonexistent/limit")
      .set(authHeader)
      .send({ spendLimitAmount: "500.00" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CARD_NOT_FOUND");
  });

  it("response data has the expected shape", async () => {
    const res = await request(app)
      .post("/cards/card-001/limit")
      .set(authHeader)
      .send({ spendLimitAmount: "600.00" });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("cardId");
    expect(res.body.data).toHaveProperty("spendLimitAmount");
    expect(res.body.data).toHaveProperty("updatedAt");
  });
});