import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import subscriptionResumeRouter, { subscriptions, webhookEvents } from "../routes/subscriptions.resume.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(subscriptionResumeRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /subscriptions/:id/resume", () => {
  const app = buildApp();

  beforeEach(() => {
    subscriptions.clear();
    webhookEvents.length = 0;
  });

  it("resumes a paused subscription successfully", async () => {
    const userId = "user-123";
    const subscriptionId = "sub-abc";
    
    subscriptions.set(subscriptionId, {
      id: subscriptionId,
      userId,
      status: "paused",
      currentPeriodEnd: new Date("2024-01-01"),
      pausedAt: new Date(),
    });

    const res = await request(app)
      .post(`/subscriptions/${subscriptionId}/resume`)
      .set("Authorization", `Bearer ${createMockToken(userId)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.currentPeriodEnd).toBeDefined();
    
    const subscription = subscriptions.get(subscriptionId);
    expect(subscription?.status).toBe("active");
    expect(subscription?.pausedAt).toBeUndefined();
    
    expect(webhookEvents.length).toBe(1);
    expect(webhookEvents[0].type).toBe("subscription.resumed");
    expect(webhookEvents[0].subscriptionId).toBe(subscriptionId);
  });

  it("rejects when subscription is not paused", async () => {
    const userId = "user-123";
    const subscriptionId = "sub-abc";
    
    subscriptions.set(subscriptionId, {
      id: subscriptionId,
      userId,
      status: "active",
      currentPeriodEnd: new Date("2024-01-01"),
    });

    const res = await request(app)
      .post(`/subscriptions/${subscriptionId}/resume`)
      .set("Authorization", `Bearer ${createMockToken(userId)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATE");
    expect(res.body.error.message).toContain("Cannot resume subscription");
  });

  it("rejects when subscription does not exist", async () => {
    const userId = "user-123";
    const subscriptionId = "sub-nonexistent";

    const res = await request(app)
      .post(`/subscriptions/${subscriptionId}/resume`)
      .set("Authorization", `Bearer ${createMockToken(userId)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects unauthorized user (different user)", async () => {
    const ownerUserId = "user-123";
    const otherUserId = "user-456";
    const subscriptionId = "sub-abc";
    
    subscriptions.set(subscriptionId, {
      id: subscriptionId,
      userId: ownerUserId,
      status: "paused",
      currentPeriodEnd: new Date("2024-01-01"),
      pausedAt: new Date(),
    });

    const res = await request(app)
      .post(`/subscriptions/${subscriptionId}/resume`)
      .set("Authorization", `Bearer ${createMockToken(otherUserId)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects when not authenticated", async () => {
    const subscriptionId = "sub-abc";

    const res = await request(app)
      .post(`/subscriptions/${subscriptionId}/resume`);

    expect(res.status).toBe(401);
  });
});

// Helper function to create a mock JWT token
function createMockToken(userId: string): string {
  // In a real scenario, this would use the actual JWT signing
  // For tests, we'll use a simple base64 encoded string
  const payload = JSON.stringify({ sub: userId, role: "user" });
  return Buffer.from(payload).toString("base64");
}
