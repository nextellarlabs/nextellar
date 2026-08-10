import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import subscriptionsCreateRouter, {
  __getSubscriptions,
  __resetSubscriptions,
} from "../routes/subscriptions.create.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(subscriptionsCreateRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /subscriptions", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetSubscriptions();
  });

  it("creates a subscription with valid data", async () => {
    const res = await request(app).post("/subscriptions").send({
      planId: "plan-pro",
      billingInterval: "monthly",
      startDate: "2024-01-01T00:00:00Z",
      userId: "user-123",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("id");
    expect(res.body.data.planId).toBe("plan-pro");
    expect(res.body.data.billingInterval).toBe("monthly");
    expect(res.body.data.userId).toBe("user-123");
    expect(res.body.data.status).toBe("active");
  });

  it("returns 400 when planId is missing", async () => {
    const res = await request(app).post("/subscriptions").send({
      billingInterval: "monthly",
      startDate: "2024-01-01T00:00:00Z",
      userId: "user-123",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PLAN_ID");
  });

  it("returns 400 when billingInterval is invalid", async () => {
    const res = await request(app).post("/subscriptions").send({
      planId: "plan-pro",
      billingInterval: "weekly",
      startDate: "2024-01-01T00:00:00Z",
      userId: "user-123",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_BILLING_INTERVAL");
  });

  it("returns 400 when startDate is missing", async () => {
    const res = await request(app).post("/subscriptions").send({
      planId: "plan-pro",
      billingInterval: "monthly",
      userId: "user-123",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_START_DATE");
  });

  it("returns 400 when startDate is not a valid ISO date", async () => {
    const res = await request(app).post("/subscriptions").send({
      planId: "plan-pro",
      billingInterval: "monthly",
      startDate: "not-a-date",
      userId: "user-123",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_START_DATE");
  });

  it("returns 400 when userId is missing", async () => {
    const res = await request(app).post("/subscriptions").send({
      planId: "plan-pro",
      billingInterval: "monthly",
      startDate: "2024-01-01T00:00:00Z",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_USER_ID");
  });

  it("handles idempotency key correctly on first request", async () => {
    const res = await request(app).post("/subscriptions").send({
      planId: "plan-pro",
      billingInterval: "monthly",
      startDate: "2024-01-01T00:00:00Z",
      userId: "user-123",
      idempotencyKey: "key-123",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(__getSubscriptions().size).toBe(1);
  });

  it("returns idempotent response on duplicate idempotency key", async () => {
    const firstRes = await request(app).post("/subscriptions").send({
      planId: "plan-pro",
      billingInterval: "monthly",
      startDate: "2024-01-01T00:00:00Z",
      userId: "user-123",
      idempotencyKey: "key-123",
    });

    expect(firstRes.status).toBe(201);
    const subscriptionId = firstRes.body.data.id;

    const secondRes = await request(app).post("/subscriptions").send({
      planId: "plan-pro",
      billingInterval: "monthly",
      startDate: "2024-01-01T00:00:00Z",
      userId: "user-123",
      idempotencyKey: "key-123",
    });

    expect(secondRes.status).toBe(200);
    expect(secondRes.body.idempotent).toBe(true);
    expect(secondRes.body.data.id).toBe(subscriptionId);
    expect(__getSubscriptions().size).toBe(1);
  });

  it("accepts yearly billing interval", async () => {
    const res = await request(app).post("/subscriptions").send({
      planId: "plan-pro",
      billingInterval: "yearly",
      startDate: "2024-01-01T00:00:00Z",
      userId: "user-123",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.billingInterval).toBe("yearly");
  });
});
