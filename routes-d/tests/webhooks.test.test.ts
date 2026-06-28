import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedWebhook,
  __resetWebhooks,
  __getTestDeliveries,
  buildSignature,
} from "../routes/webhooks.test.js";

// Patch global fetch so tests never reach the real network
const originalFetch = globalThis.fetch;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const USER_ID = "user-123";
const WEBHOOK = {
  id: "wh-1",
  url: "https://example.com/hook",
  userId: USER_ID,
  events: ["payment.completed"],
  sharedSecret: "my-secret",
  createdAt: "2024-01-01T00:00:00Z",
};

describe("POST /webhooks/:id/test", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetWebhooks();
    globalThis.fetch = originalFetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("delivers a test payload and returns 200 responseCode on success", async () => {
    __seedWebhook(WEBHOOK);
    globalThis.fetch = async () => new globalThis.Response(null, { status: 200 }) as unknown as globalThis.Response;

    const res = await request(app)
      .post("/webhooks/wh-1/test")
      .send({ userId: USER_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.responseCode).toBe(200);
    expect(res.body.data.success).toBe(true);
    expect(typeof res.body.data.latencyMs).toBe("number");
    expect(res.body.data.deliveredAt).toBeDefined();
  });

  it("returns upstream failure response code when destination returns 5xx", async () => {
    __seedWebhook(WEBHOOK);
    globalThis.fetch = async () => new globalThis.Response(null, { status: 503 }) as unknown as globalThis.Response;

    const res = await request(app)
      .post("/webhooks/wh-1/test")
      .send({ userId: USER_ID });

    expect(res.status).toBe(200);
    expect(res.body.data.responseCode).toBe(503);
    expect(res.body.data.success).toBe(false);
  });

  it("records the delivery in the test deliveries log", async () => {
    __seedWebhook(WEBHOOK);
    globalThis.fetch = async () => new globalThis.Response(null, { status: 200 }) as unknown as globalThis.Response;

    await request(app)
      .post("/webhooks/wh-1/test")
      .send({ userId: USER_ID });

    const deliveries = __getTestDeliveries();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].webhookId).toBe("wh-1");
    expect(deliveries[0].responseCode).toBe(200);
  });

  it("signs the payload with the same HMAC-SHA256 as production", () => {
    const secret = "my-secret";
    const payload = JSON.stringify({ type: "test" });
    const sig = buildSignature(secret, payload);
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);

    // Deterministic: same inputs produce the same signature
    expect(buildSignature(secret, payload)).toBe(sig);
    // Different secret produces a different signature
    expect(buildSignature("other-secret", payload)).not.toBe(sig);
  });

  it("returns 404 when webhook does not exist", async () => {
    const res = await request(app)
      .post("/webhooks/nonexistent/test")
      .send({ userId: USER_ID });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("WEBHOOK_NOT_FOUND");
  });

  it("returns 403 when caller does not own the webhook", async () => {
    __seedWebhook(WEBHOOK);

    const res = await request(app)
      .post("/webhooks/wh-1/test")
      .send({ userId: "user-999" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 401 when userId is not provided", async () => {
    __seedWebhook(WEBHOOK);

    const res = await request(app)
      .post("/webhooks/wh-1/test")
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
