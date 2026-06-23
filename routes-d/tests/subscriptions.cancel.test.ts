import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import subscriptionsCancelRouter, {
  __getSubscriptions,
  __getEmittedWebhooks,
  __resetSubscriptions,
  __seedSubscription,
} from "../routes/subscriptions.cancel.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(subscriptionsCancelRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /subscriptions/:id/cancel", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetSubscriptions();
  });

  it("cancels an active subscription", async () => {
    const subscription = {
      id: "sub-123",
      planId: "plan-pro",
      billingInterval: "monthly" as const,
      startDate: "2024-01-01T00:00:00Z",
      userId: "user-123",
      status: "active" as const,
    };
    __seedSubscription(subscription);

    const res = await request(app).post("/subscriptions/sub-123/cancel");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("cancelled");
    expect(res.body.data.cancelledAt).toBeDefined();
    expect(res.body.data.periodEndDate).toBeDefined();
  });

  it("emits a webhook event on cancellation", async () => {
    const subscription = {
      id: "sub-123",
      planId: "plan-pro",
      billingInterval: "monthly" as const,
      startDate: "2024-01-01T00:00:00Z",
      userId: "user-123",
      status: "active" as const,
    };
    __seedSubscription(subscription);

    await request(app).post("/subscriptions/sub-123/cancel");

    const webhooks = __getEmittedWebhooks();
    expect(webhooks).toHaveLength(1);
    expect(webhooks[0].event).toBe("subscription.cancelled");
    expect(webhooks[0].subscriptionId).toBe("sub-123");
    expect(webhooks[0].timestamp).toBeDefined();
  });

  it("returns 400 when subscription is already cancelled", async () => {
    const subscription = {
      id: "sub-123",
      planId: "plan-pro",
      billingInterval: "monthly" as const,
      startDate: "2024-01-01T00:00:00Z",
      userId: "user-123",
      status: "cancelled" as const,
      cancelledAt: "2024-01-15T00:00:00Z",
    };
    __seedSubscription(subscription);

    const res = await request(app).post("/subscriptions/sub-123/cancel");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SUBSCRIPTION_ALREADY_CANCELLED");
  });

  it("returns 404 when subscription does not exist", async () => {
    const res = await request(app).post("/subscriptions/nonexistent/cancel");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SUBSCRIPTION_NOT_FOUND");
  });

  it("returns 404 when subscription id is missing", async () => {
    const res = await request(app).post("/subscriptions//cancel");

    expect(res.status).toBe(404);
  });

  it("can cancel a paused subscription", async () => {
    const subscription = {
      id: "sub-123",
      planId: "plan-pro",
      billingInterval: "monthly" as const,
      startDate: "2024-01-01T00:00:00Z",
      userId: "user-123",
      status: "paused" as const,
    };
    __seedSubscription(subscription);

    const res = await request(app).post("/subscriptions/sub-123/cancel");

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
  });
});
