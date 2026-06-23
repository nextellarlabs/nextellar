import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import subscriptionsPauseRouter, {
  __getSubscriptions,
  __getEmittedWebhooks,
  __resetSubscriptions,
  __seedSubscription,
} from "../routes/subscriptions.pause.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(subscriptionsPauseRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /subscriptions/:id/pause", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetSubscriptions();
  });

  it("pauses an active subscription", async () => {
    const subscription = {
      id: "sub-123",
      planId: "plan-pro",
      billingInterval: "monthly" as const,
      startDate: "2024-01-01T00:00:00Z",
      userId: "user-123",
      status: "active" as const,
    };
    __seedSubscription(subscription);

    const res = await request(app).post("/subscriptions/sub-123/pause");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("paused");
    expect(res.body.data.pausedAt).toBeDefined();
  });

  it("emits a webhook event on pause", async () => {
    const subscription = {
      id: "sub-123",
      planId: "plan-pro",
      billingInterval: "monthly" as const,
      startDate: "2024-01-01T00:00:00Z",
      userId: "user-123",
      status: "active" as const,
    };
    __seedSubscription(subscription);

    await request(app).post("/subscriptions/sub-123/pause");

    const webhooks = __getEmittedWebhooks();
    expect(webhooks).toHaveLength(1);
    expect(webhooks[0].event).toBe("subscription.paused");
    expect(webhooks[0].subscriptionId).toBe("sub-123");
    expect(webhooks[0].timestamp).toBeDefined();
  });

  it("returns 400 when subscription is already paused", async () => {
    const subscription = {
      id: "sub-123",
      planId: "plan-pro",
      billingInterval: "monthly" as const,
      startDate: "2024-01-01T00:00:00Z",
      userId: "user-123",
      status: "paused" as const,
      pausedAt: "2024-01-15T00:00:00Z",
    };
    __seedSubscription(subscription);

    const res = await request(app).post("/subscriptions/sub-123/pause");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SUBSCRIPTION_ALREADY_PAUSED");
  });

  it("returns 400 when subscription is cancelled", async () => {
    const subscription = {
      id: "sub-123",
      planId: "plan-pro",
      billingInterval: "monthly" as const,
      startDate: "2024-01-01T00:00:00Z",
      userId: "user-123",
      status: "cancelled" as const,
    };
    __seedSubscription(subscription);

    const res = await request(app).post("/subscriptions/sub-123/pause");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SUBSCRIPTION_CANCELLED");
  });

  it("returns 404 when subscription does not exist", async () => {
    const res = await request(app).post("/subscriptions/nonexistent/pause");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SUBSCRIPTION_NOT_FOUND");
  });

  it("returns 404 when subscription id is missing", async () => {
    const res = await request(app).post("/subscriptions//pause");

    expect(res.status).toBe(404);
  });
});
