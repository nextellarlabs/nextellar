import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import invoicePayRouter, {
  __resetInvoices,
  __seedInvoice,
  __getInvoice,
} from "../routes/invoices.pay.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(invoicePayRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const ISSUER = "user-issuer";
const PAYER = "user-payer";
const OTHER = "user-other";
const INV_ID = "inv-001";
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);

describe("POST /invoices/:id/pay", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetInvoices();
  });

  it("pays a pending invoice successfully", async () => {
    __seedInvoice({ id: INV_ID, issuerId: ISSUER, payerId: PAYER, status: "pending", amount: 200, currency: "USDC", lineItems: [], createdAt: new Date(), dueDate: FUTURE });

    const res = await request(app)
      .post(`/invoices/${INV_ID}/pay`)
      .set("x-user-id", PAYER);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("paid");
    expect(res.body.data.paidAt).toBeDefined();
    expect(res.body.data.stellarTxHash).toBeDefined();
    expect(res.body.idempotent).toBeUndefined();
  });

  it("persists paid status on the stored invoice", async () => {
    __seedInvoice({ id: INV_ID, issuerId: ISSUER, payerId: PAYER, status: "pending", amount: 200, currency: "USDC", lineItems: [], createdAt: new Date(), dueDate: FUTURE });

    await request(app).post(`/invoices/${INV_ID}/pay`).set("x-user-id", PAYER);

    expect(__getInvoice(INV_ID)?.status).toBe("paid");
  });

  it("is idempotent — second call returns same paid record", async () => {
    __seedInvoice({ id: INV_ID, issuerId: ISSUER, payerId: PAYER, status: "pending", amount: 200, currency: "USDC", lineItems: [], createdAt: new Date(), dueDate: FUTURE });

    const first = await request(app).post(`/invoices/${INV_ID}/pay`).set("x-user-id", PAYER);
    const second = await request(app).post(`/invoices/${INV_ID}/pay`).set("x-user-id", PAYER);

    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
    expect(second.body.data.stellarTxHash).toBe(first.body.data.stellarTxHash);
  });

  it("rejects when invoice is already paid by a different payer", async () => {
    __seedInvoice({ id: INV_ID, issuerId: ISSUER, payerId: PAYER, status: "paid", amount: 200, currency: "USDC", lineItems: [], createdAt: new Date(), dueDate: FUTURE, paidAt: new Date() });

    const res = await request(app)
      .post(`/invoices/${INV_ID}/pay`)
      .set("x-user-id", PAYER);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_PAID");
  });

  it("rejects paying a voided invoice", async () => {
    __seedInvoice({ id: INV_ID, issuerId: ISSUER, payerId: PAYER, status: "voided", amount: 200, currency: "USDC", lineItems: [], createdAt: new Date(), dueDate: FUTURE });

    const res = await request(app)
      .post(`/invoices/${INV_ID}/pay`)
      .set("x-user-id", PAYER);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVOICE_VOIDED");
  });

  it("rejects paying an expired invoice (past dueDate)", async () => {
    __seedInvoice({ id: INV_ID, issuerId: ISSUER, payerId: PAYER, status: "pending", amount: 200, currency: "USDC", lineItems: [], createdAt: new Date(), dueDate: PAST });

    const res = await request(app)
      .post(`/invoices/${INV_ID}/pay`)
      .set("x-user-id", PAYER);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVOICE_EXPIRED");
  });

  it("rejects when caller is not the payer", async () => {
    __seedInvoice({ id: INV_ID, issuerId: ISSUER, payerId: PAYER, status: "pending", amount: 200, currency: "USDC", lineItems: [], createdAt: new Date(), dueDate: FUTURE });

    const res = await request(app)
      .post(`/invoices/${INV_ID}/pay`)
      .set("x-user-id", OTHER);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects when invoice is not found", async () => {
    const res = await request(app)
      .post("/invoices/nonexistent/pay")
      .set("x-user-id", PAYER);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects unauthenticated request", async () => {
    const res = await request(app).post(`/invoices/${INV_ID}/pay`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
