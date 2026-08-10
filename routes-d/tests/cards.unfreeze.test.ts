import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __resetCardStore,
  __seedCard,
  __getCard,
  __getAuditEvents,
} from "../routes/cards.unfreeze.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /cards/:id/unfreeze", () => {
  const app = buildApp();
  const userId = "user-001";
  const authHeader = { "x-user-id": userId, "x-auth-timestamp": String(Date.now()) };

  const FROZEN_CARD: CardRecord = {
    cardId: "card-001",
    userId,
    status: "frozen",
    maskedNumber: "****-****-****-1234",
    expiryMonth: "12",
    expiryYear: "2027",
    currency: "USDC",
    spendLimitAmount: "500.00",
    issuedAt: "2024-01-01T00:00:00Z",
    frozenAt: "2024-06-01T10:00:00Z",
  };

  const ACTIVE_CARD: CardRecord = {
    cardId: "card-002",
    userId,
    status: "active",
    maskedNumber: "****-****-****-5678",
    expiryMonth: "06",
    expiryYear: "2026",
    currency: "USDC",
    spendLimitAmount: "300.00",
    issuedAt: "2024-01-01T00:00:00Z",
  };

  const CLOSED_CARD: CardRecord = {
    cardId: "card-003",
    userId,
    status: "closed",
    maskedNumber: "****-****-****-9999",
    expiryMonth: "01",
    expiryYear: "2025",
    currency: "USDC",
    spendLimitAmount: "100.00",
    issuedAt: "2024-01-01T00:00:00Z",
  };

  type CardRecord = typeof FROZEN_CARD;

  beforeEach(() => {
    __resetCardStore();
    __seedCard(FROZEN_CARD);
    __seedCard(ACTIVE_CARD);
    __seedCard(CLOSED_CARD);
  });

  it("unfreezes a frozen card and returns 200", async () => {
    const res = await request(app)
      .post("/cards/card-001/unfreeze")
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.cardId).toBe("card-001");
    expect(res.body.data.unfrozenAt).toBeDefined();
  });

  it("persists unfreeze in storage", async () => {
    await request(app)
      .post("/cards/card-001/unfreeze")
      .set(authHeader);
    const stored = __getCard("card-001")!;
    expect(stored.status).toBe("active");
    expect(stored.unfrozenAt).toBeDefined();
  });

  it("emits an audit event on unfreeze", async () => {
    await request(app)
      .post("/cards/card-001/unfreeze")
      .set(authHeader);
    const events = __getAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("unfreeze");
    expect(events[0].cardId).toBe("card-001");
    expect(events[0].performedBy).toBe(userId);
  });

  it("returns 409 ALREADY_ACTIVE when card is already active", async () => {
    const res = await request(app)
      .post("/cards/card-002/unfreeze")
      .set(authHeader);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_ACTIVE");
  });

  it("returns 409 CARD_CLOSED when card is closed", async () => {
    const res = await request(app)
      .post("/cards/card-003/unfreeze")
      .set(authHeader);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CARD_CLOSED");
  });

  it("returns 401 when x-user-id header is missing", async () => {
    const res = await request(app)
      .post("/cards/card-001/unfreeze")
      .set("x-auth-timestamp", String(Date.now()));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 REAUTH_REQUIRED when auth timestamp is missing", async () => {
    const res = await request(app)
      .post("/cards/card-001/unfreeze")
      .set("x-user-id", userId);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("REAUTH_REQUIRED");
  });

  it("returns 403 REAUTH_REQUIRED when auth timestamp is stale", async () => {
    const oldTimestamp = String(Date.now() - 600_000); // 10 minutes ago
    const res = await request(app)
      .post("/cards/card-001/unfreeze")
      .set("x-user-id", userId)
      .set("x-auth-timestamp", oldTimestamp);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("REAUTH_REQUIRED");
  });

  it("returns 403 FORBIDDEN when user is not card owner", async () => {
    const res = await request(app)
      .post("/cards/card-001/unfreeze")
      .set("x-user-id", "other-user")
      .set("x-auth-timestamp", String(Date.now()));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 400 INVALID_CARD_ID when card id is missing", async () => {
    const res = await request(app)
      .post("/cards//unfreeze")
      .set(authHeader);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CARD_ID");
  });

  it("returns 404 CARD_NOT_FOUND for unknown card", async () => {
    const res = await request(app)
      .post("/cards/nonexistent/unfreeze")
      .set(authHeader);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CARD_NOT_FOUND");
  });
});