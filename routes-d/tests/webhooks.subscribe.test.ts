import express, { type Express } from "express";
import request from "supertest";
import {
  createInMemoryWebhookSubscriptionStore,
  type WebhookSubscriptionStore,
} from "../lib/webhookDispatcher.js";
import { createWebhooksSubscribeRouter } from "../routes/webhooks.subscribe.js";

const accountId = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function buildApp(store: WebhookSubscriptionStore): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/webhooks/subscribe",
    createWebhooksSubscribeRouter({
      store,
      now: () => new Date("2026-06-01T18:00:00.000Z"),
      nextId: () => "sub_1",
      nextSecret: () => "generated-secret-value",
    }),
  );
  return app;
}

describe("POST /webhooks/subscribe", () => {
  it("registers a webhook URL for a watched Stellar account", async () => {
    const store = createInMemoryWebhookSubscriptionStore();
    const app = buildApp(store);

    const res = await request(app).post("/webhooks/subscribe").send({
      accountId,
      url: "https://downstream.example/stellar",
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      ok: true,
      subscription: {
        id: "sub_1",
        accountId,
        url: "https://downstream.example/stellar",
        createdAt: "2026-06-01T18:00:00.000Z",
      },
      secret: "generated-secret-value",
    });

    const stored = await store.listByAccount(accountId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: "sub_1",
      accountId,
      url: "https://downstream.example/stellar",
      secret: "generated-secret-value",
    });
  });

  it("accepts caller-provided secrets without echoing them", async () => {
    const store = createInMemoryWebhookSubscriptionStore();
    const app = buildApp(store);

    const res = await request(app).post("/webhooks/subscribe").send({
      accountId,
      url: "https://downstream.example/stellar",
      secret: "caller-provided-secret",
    });

    expect(res.status).toBe(201);
    expect(res.body.secret).toBeUndefined();

    const stored = await store.listByAccount(accountId);
    expect(stored[0]!.secret).toBe("caller-provided-secret");
  });

  it("rejects malformed Stellar account IDs", async () => {
    const app = buildApp(createInMemoryWebhookSubscriptionStore());

    const res = await request(app).post("/webhooks/subscribe").send({
      accountId: "not-an-account",
      url: "https://downstream.example/stellar",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/accountId/);
  });

  it("rejects non-HTTPS callback URLs", async () => {
    const app = buildApp(createInMemoryWebhookSubscriptionStore());

    const res = await request(app).post("/webhooks/subscribe").send({
      accountId,
      url: "http://downstream.example/stellar",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/HTTPS URL/);
  });
});
