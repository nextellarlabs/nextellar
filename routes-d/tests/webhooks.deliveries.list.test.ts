import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import webhookDeliveriesListRouter, { webhookDeliveries } from "../routes/webhooks.deliveries.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(webhookDeliveriesListRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /webhooks/:id/deliveries", () => {
  const app = buildApp();
  const webhookId = "webhook-123";
  const userId = "user-123";

  beforeEach(() => {
    webhookDeliveries.clear();
  });

  it("returns empty list when no deliveries exist", async () => {
    const res = await request(app)
      .get(`/webhooks/${webhookId}/deliveries`)
      .set("Authorization", `Bearer ${createMockToken(userId)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it("returns failed delivery surface", async () => {
    const deliveries = [
      {
        id: "del-1",
        webhookId,
        attemptNumber: 1,
        responseCode: 500,
        latency: 250,
        attemptTime: new Date("2024-01-01T10:00:00Z"),
        success: false,
        errorMessage: "Internal server error",
      },
      {
        id: "del-2",
        webhookId,
        attemptNumber: 2,
        responseCode: 200,
        latency: 100,
        attemptTime: new Date("2024-01-01T10:05:00Z"),
        success: true,
      },
    ];

    webhookDeliveries.set(webhookId, deliveries);

    const res = await request(app)
      .get(`/webhooks/${webhookId}/deliveries`)
      .set("Authorization", `Bearer ${createMockToken(userId)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data[0].responseCode).toBe(200); // Newest first
    expect(res.body.data[1].responseCode).toBe(500);
    expect(res.body.data[1].errorMessage).toBe("Internal server error");
  });

  it("paginates results correctly", async () => {
    const deliveries = Array.from({ length: 25 }, (_, i) => ({
      id: `del-${i}`,
      webhookId,
      attemptNumber: i + 1,
      responseCode: 200,
      latency: 50 + i,
      attemptTime: new Date(Date.now() - i * 1000),
      success: true,
    }));

    webhookDeliveries.set(webhookId, deliveries);

    const res = await request(app)
      .get(`/webhooks/${webhookId}/deliveries?page=1&limit=10`)
      .set("Authorization", `Bearer ${createMockToken(userId)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(10);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(10);
    expect(res.body.pagination.total).toBe(25);
    expect(res.body.pagination.totalPages).toBe(3);
  });

  it("sorts by attempt time (newest first)", async () => {
    const deliveries = [
      {
        id: "del-1",
        webhookId,
        attemptNumber: 1,
        responseCode: 200,
        latency: 100,
        attemptTime: new Date("2024-01-01T10:00:00Z"),
        success: true,
      },
      {
        id: "del-2",
        webhookId,
        attemptNumber: 2,
        responseCode: 200,
        latency: 150,
        attemptTime: new Date("2024-01-01T11:00:00Z"),
        success: true,
      },
      {
        id: "del-3",
        webhookId,
        attemptNumber: 3,
        responseCode: 200,
        latency: 200,
        attemptTime: new Date("2024-01-01T09:00:00Z"),
        success: true,
      },
    ];

    webhookDeliveries.set(webhookId, deliveries);

    const res = await request(app)
      .get(`/webhooks/${webhookId}/deliveries`)
      .set("Authorization", `Bearer ${createMockToken(userId)}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe("del-2"); // 11:00 - newest
    expect(res.body.data[1].id).toBe("del-1"); // 10:00
    expect(res.body.data[2].id).toBe("del-3"); // 09:00 - oldest
  });

  it("rejects invalid pagination parameters", async () => {
    const res = await request(app)
      .get(`/webhooks/${webhookId}/deliveries?page=0`)
      .set("Authorization", `Bearer ${createMockToken(userId)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAGINATION");
  });

  it("rejects when not authenticated", async () => {
    const res = await request(app)
      .get(`/webhooks/${webhookId}/deliveries`);

    expect(res.status).toBe(401);
  });
});

// Helper function to create a mock JWT token
function createMockToken(userId: string): string {
  const payload = JSON.stringify({ sub: userId, role: "user" });
  return Buffer.from(payload).toString("base64");
}
