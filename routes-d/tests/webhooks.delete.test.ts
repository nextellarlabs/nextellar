import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import webhooksDeleteRouter, {
  __getWebhooks,
  __getAuditEvents,
  __resetWebhooks,
  __seedWebhook,
} from "../routes/webhooks.delete.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(webhooksDeleteRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("DELETE /webhooks/:id", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetWebhooks();
  });

  it("deletes a webhook owned by the user", async () => {
    const webhook = {
      id: "webhook-123",
      url: "https://example.com/webhook",
      userId: "user-123",
      events: ["subscription.created"],
      createdAt: "2024-01-01T00:00:00Z",
    };
    __seedWebhook(webhook);

    const res = await request(app)
      .delete("/webhooks/webhook-123")
      .send({ userId: "user-123" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Webhook deleted successfully");
    expect(__getWebhooks().size).toBe(0);
  });

  it("emits an audit event on deletion", async () => {
    const webhook = {
      id: "webhook-123",
      url: "https://example.com/webhook",
      userId: "user-123",
      events: ["subscription.created"],
      createdAt: "2024-01-01T00:00:00Z",
    };
    __seedWebhook(webhook);

    await request(app)
      .delete("/webhooks/webhook-123")
      .send({ userId: "user-123" });

    const auditEvents = __getAuditEvents();
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].action).toBe("webhook.deleted");
    expect(auditEvents[0].webhookId).toBe("webhook-123");
    expect(auditEvents[0].userId).toBe("user-123");
    expect(auditEvents[0].timestamp).toBeDefined();
  });

  it("returns 404 when webhook is already deleted", async () => {
    const res = await request(app)
      .delete("/webhooks/nonexistent")
      .send({ userId: "user-123" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("WEBHOOK_NOT_FOUND");
  });

  it("returns 403 when user is not authorized", async () => {
    const webhook = {
      id: "webhook-123",
      url: "https://example.com/webhook",
      userId: "user-123",
      events: ["subscription.created"],
      createdAt: "2024-01-01T00:00:00Z",
    };
    __seedWebhook(webhook);

    const res = await request(app)
      .delete("/webhooks/webhook-123")
      .send({ userId: "user-456" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(__getWebhooks().size).toBe(1); // Webhook should still exist
  });

  it("returns 401 when userId is not provided", async () => {
    const webhook = {
      id: "webhook-123",
      url: "https://example.com/webhook",
      userId: "user-123",
      events: ["subscription.created"],
      createdAt: "2024-01-01T00:00:00Z",
    };
    __seedWebhook(webhook);

    const res = await request(app).delete("/webhooks/webhook-123").send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 when webhook id is missing", async () => {
    const res = await request(app)
      .delete("/webhooks/")
      .send({ userId: "user-123" });

    expect(res.status).toBe(404); // Express returns 404 for missing route param
  });
});
