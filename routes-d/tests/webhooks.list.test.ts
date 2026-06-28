import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedWebhook,
  __resetWebhooks,
} from "../routes/webhooks.list.js";

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

const WEBHOOK_A = {
  id: "wh-1",
  url: "https://example.com/hook1",
  userId: USER_ID,
  events: ["payment.completed", "payment.failed"],
  sharedSecret: "supersecret1",
  createdAt: "2024-01-01T00:00:00Z",
};

const WEBHOOK_B = {
  id: "wh-2",
  url: "https://example.com/hook2",
  userId: USER_ID,
  events: ["subscription.created"],
  sharedSecret: "anothersecret",
  createdAt: "2024-01-02T00:00:00Z",
};

const OTHER_USER_WEBHOOK = {
  id: "wh-3",
  url: "https://other.example.com/hook",
  userId: "user-999",
  events: ["payment.completed"],
  sharedSecret: "theirsecret",
  createdAt: "2024-01-03T00:00:00Z",
};

describe("GET /webhooks", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetWebhooks();
  });

  it("returns an empty list when the user has no webhooks", async () => {
    const res = await request(app)
      .get("/webhooks")
      .send({ userId: USER_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it("returns only webhooks belonging to the calling user", async () => {
    __seedWebhook(WEBHOOK_A);
    __seedWebhook(WEBHOOK_B);
    __seedWebhook(OTHER_USER_WEBHOOK);

    const res = await request(app)
      .get("/webhooks")
      .send({ userId: USER_ID });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const ids = res.body.data.map((w: { id: string }) => w.id);
    expect(ids).toContain("wh-1");
    expect(ids).toContain("wh-2");
    expect(ids).not.toContain("wh-3");
  });

  it("masks shared secrets in the response", async () => {
    __seedWebhook(WEBHOOK_A);

    const res = await request(app)
      .get("/webhooks")
      .send({ userId: USER_ID });

    expect(res.status).toBe(200);
    const webhook = res.body.data[0];
    expect(webhook.sharedSecret).not.toBe("supersecret1");
    expect(webhook.sharedSecret).toMatch(/^supe\*{4}$/);
  });

  it("filters by event type when ?eventType is supplied", async () => {
    __seedWebhook(WEBHOOK_A);
    __seedWebhook(WEBHOOK_B);

    const res = await request(app)
      .get("/webhooks?eventType=payment.completed")
      .send({ userId: USER_ID });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe("wh-1");
  });

  it("returns an empty list when event type filter matches nothing", async () => {
    __seedWebhook(WEBHOOK_A);
    __seedWebhook(WEBHOOK_B);

    const res = await request(app)
      .get("/webhooks?eventType=nonexistent.event")
      .send({ userId: USER_ID });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("returns 401 when userId is not provided", async () => {
    const res = await request(app).get("/webhooks").send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("accepts userId from x-user-id header", async () => {
    __seedWebhook(WEBHOOK_A);

    const res = await request(app)
      .get("/webhooks")
      .set("x-user-id", USER_ID);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});
