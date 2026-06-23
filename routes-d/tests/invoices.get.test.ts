import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import invoiceGetRouter, { invoices } from "../routes/invoices.get.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(invoiceGetRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /invoices/:id", () => {
  const app = buildApp();

  beforeEach(() => {
    invoices.clear();
  });

  it("returns invoice details for authorized issuer", async () => {
    const issuerId = "user-123";
    const payerId = "user-456";
    const invoiceId = "inv-abc";
    
    invoices.set(invoiceId, {
      id: invoiceId,
      issuerId,
      payerId,
      status: "pending",
      amount: 100,
      currency: "USD",
      lineItems: [
        {
          id: "line-1",
          description: "Service A",
          quantity: 1,
          unitPrice: 100,
          amount: 100,
        },
      ],
      createdAt: new Date("2024-01-01"),
      dueDate: new Date("2024-01-15"),
    });

    const res = await request(app)
      .get(`/invoices/${invoiceId}`)
      .set("Authorization", `Bearer ${createMockToken(issuerId)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(invoiceId);
    expect(res.body.data.status).toBe("pending");
    expect(res.body.data.amount).toBe(100);
    expect(res.body.data.lineItems).toHaveLength(1);
    expect(res.body.data.lineItems[0].description).toBe("Service A");
  });

  it("returns invoice details for authorized payer", async () => {
    const issuerId = "user-123";
    const payerId = "user-456";
    const invoiceId = "inv-abc";
    
    invoices.set(invoiceId, {
      id: invoiceId,
      issuerId,
      payerId,
      status: "paid",
      amount: 100,
      currency: "USD",
      lineItems: [],
      createdAt: new Date("2024-01-01"),
      dueDate: new Date("2024-01-15"),
      paidAt: new Date("2024-01-10"),
      stellarTxHash: "tx-abc123",
    });

    const res = await request(app)
      .get(`/invoices/${invoiceId}`)
      .set("Authorization", `Bearer ${createMockToken(payerId)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("paid");
    expect(res.body.data.paidAt).toBeDefined();
    expect(res.body.data.stellarTxHash).toBe("tx-abc123");
  });

  it("rejects unknown invoice", async () => {
    const userId = "user-123";
    const invoiceId = "inv-nonexistent";

    const res = await request(app)
      .get(`/invoices/${invoiceId}`)
      .set("Authorization", `Bearer ${createMockToken(userId)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects unauthorized caller (neither issuer nor payer)", async () => {
    const issuerId = "user-123";
    const payerId = "user-456";
    const otherUserId = "user-789";
    const invoiceId = "inv-abc";
    
    invoices.set(invoiceId, {
      id: invoiceId,
      issuerId,
      payerId,
      status: "pending",
      amount: 100,
      currency: "USD",
      lineItems: [],
      createdAt: new Date("2024-01-01"),
      dueDate: new Date("2024-01-15"),
    });

    const res = await request(app)
      .get(`/invoices/${invoiceId}`)
      .set("Authorization", `Bearer ${createMockToken(otherUserId)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(res.body.error.message).toContain("do not have access");
  });

  it("rejects when not authenticated", async () => {
    const invoiceId = "inv-abc";

    const res = await request(app)
      .get(`/invoices/${invoiceId}`);

    expect(res.status).toBe(401);
  });
});

// Helper function to create a mock JWT token
function createMockToken(userId: string): string {
  const payload = JSON.stringify({ sub: userId, role: "user" });
  return Buffer.from(payload).toString("base64");
}
