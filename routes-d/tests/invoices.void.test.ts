import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import invoiceVoidRouter, { invoices } from "../routes/invoices.void.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(invoiceVoidRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /invoices/:id/void", () => {
  const app = buildApp();

  beforeEach(() => {
    invoices.clear();
  });

  it("voids an unpaid invoice successfully", async () => {
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
      createdAt: new Date(),
    });

    const res = await request(app)
      .post(`/invoices/${invoiceId}/void`)
      .set("Authorization", `Bearer ${createMockToken(issuerId)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("voided");
    
    const invoice = invoices.get(invoiceId);
    expect(invoice?.status).toBe("voided");
  });

  it("rejects when invoice has already been paid", async () => {
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
      createdAt: new Date(),
      paidAt: new Date(),
      stellarTxHash: "tx-123",
    });

    const res = await request(app)
      .post(`/invoices/${invoiceId}/void`)
      .set("Authorization", `Bearer ${createMockToken(issuerId)}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATE");
    expect(res.body.error.message).toContain("already been paid");
  });

  it("rejects unauthorized caller (not the issuer)", async () => {
    const issuerId = "user-123";
    const otherUserId = "user-789";
    const payerId = "user-456";
    const invoiceId = "inv-abc";
    
    invoices.set(invoiceId, {
      id: invoiceId,
      issuerId,
      payerId,
      status: "pending",
      amount: 100,
      currency: "USD",
      createdAt: new Date(),
    });

    const res = await request(app)
      .post(`/invoices/${invoiceId}/void`)
      .set("Authorization", `Bearer ${createMockToken(otherUserId)}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(res.body.error.message).toContain("Only the invoice issuer");
  });

  it("rejects when invoice does not exist", async () => {
    const userId = "user-123";
    const invoiceId = "inv-nonexistent";

    const res = await request(app)
      .post(`/invoices/${invoiceId}/void`)
      .set("Authorization", `Bearer ${createMockToken(userId)}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects when not authenticated", async () => {
    const invoiceId = "inv-abc";

    const res = await request(app)
      .post(`/invoices/${invoiceId}/void`);

    expect(res.status).toBe(401);
  });
});

// Helper function to create a mock JWT token
function createMockToken(userId: string): string {
  const payload = JSON.stringify({ sub: userId, role: "user" });
  return Buffer.from(payload).toString("base64");
}
