import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import webhookUpdateRouter, {
  __getAuditEvents,
  __getWebhooks,
  __resetWebhooks,
  __seedWebhook,
} from "../routes/webhooks.update.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(webhookUpdateRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("PATCH /webhooks/:id", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetWebhooks();
  });

  it("updates url, sharedSecret, and events and emits an audit event", async () => {
    __seedWebhook({
      id: "wh-1",
      url: "https://example.com/original",
      userId: "user-123",
      events: ["payment.completed"],
      sharedSecret: "secret-1234",
      createdAt: "2024-01-01T00:00:00Z",
    });

    const res = await request(app)
      .patch("/webhooks/wh-1")
      .send({
        userId: "user-123",
        url: "https://example.com/updated",
        sharedSecret: "rotated-secret",
        events: ["invoice.paid", "payment.completed"],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.updated).toBe(true);
    expect(res.body.data.webhook.url).toBe("https://example.com/updated");
    expect(res.body.data.webhook.events).toEqual(["invoice.paid", "payment.completed"]);
    expect(res.body.data.webhook.sharedSecret).toBe("rota****");

    const stored = __getWebhooks().get("wh-1");
    expect(stored?.sharedSecret).toBe("rotated-secret");

    const auditEvents = __getAuditEvents();
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].action).toBe("webhook.updated");
    expect(auditEvents[0].changedFields).toEqual(["url", "sharedSecret", "events"]);
  });

  it("returns 400 when url is invalid", async () => {
    __seedWebhook({
      id: "wh-1",
      url: "https://example.com/original",
      userId: "user-123",
      events: ["payment.completed"],
      sharedSecret: "secret-1234",
      createdAt: "2024-01-01T00:00:00Z",
    });

    const res = await request(app)
      .patch("/webhooks/wh-1")
      .send({
        userId: "user-123",
        url: "ftp://bad.example.com/hook",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_URL");
    expect(__getAuditEvents()).toHaveLength(0);
  });

  it("returns 403 when the webhook belongs to another user", async () => {
    __seedWebhook({
      id: "wh-1",
      url: "https://example.com/original",
      userId: "user-123",
      events: ["payment.completed"],
      sharedSecret: "secret-1234",
      createdAt: "2024-01-01T00:00:00Z",
    });

    const res = await request(app)
      .patch("/webhooks/wh-1")
      .send({
        userId: "user-999",
        url: "https://example.com/updated",
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(__getAuditEvents()).toHaveLength(0);
    expect(__getWebhooks().get("wh-1")?.url).toBe("https://example.com/original");
  });
});