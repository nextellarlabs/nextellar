import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import invoicePdfRouter, {
  __resetInvoices,
  __seedInvoice,
} from "../routes/invoices.pdf.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(invoicePdfRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const ISSUER = "user-issuer";
const PAYER = "user-payer";
const OTHER = "user-other";
const INV_ID = "inv-001";

const BASE_INVOICE = {
  id: INV_ID,
  issuerId: ISSUER,
  payerId: PAYER,
  status: "pending" as const,
  amount: 150,
  currency: "USDC",
  lineItems: [{ description: "Design work", quantity: 3, unitPrice: 50, amount: 150 }],
  createdAt: new Date("2024-01-01"),
  dueDate: new Date("2024-02-01"),
};

describe("GET /invoices/:id/pdf", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetInvoices();
  });

  // --- render ---

  it("returns a PDF for the issuer", async () => {
    __seedInvoice(BASE_INVOICE);

    const res = await request(app)
      .get(`/invoices/${INV_ID}/pdf`)
      .set("x-user-id", ISSUER);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toContain(`invoice-${INV_ID}.pdf`);
    expect(res.body).toBeDefined();
  });

  it("returns a PDF for the payer", async () => {
    __seedInvoice(BASE_INVOICE);

    const res = await request(app)
      .get(`/invoices/${INV_ID}/pdf`)
      .set("x-user-id", PAYER);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
  });

  it("PDF body contains the invoice ID and amount", async () => {
    __seedInvoice(BASE_INVOICE);

    const res = await request(app)
      .get(`/invoices/${INV_ID}/pdf`)
      .set("x-user-id", ISSUER)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks).toString("utf8")));
      });

    expect(res.text).toContain(INV_ID);
    expect(res.text).toContain("150");
  });

  // --- locale ---

  it("renders with default English locale", async () => {
    __seedInvoice(BASE_INVOICE);

    const res = await request(app)
      .get(`/invoices/${INV_ID}/pdf`)
      .set("x-user-id", ISSUER)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks).toString("utf8")));
      });

    expect(res.text).toContain("Invoice");
    expect(res.text).toContain("Total");
  });

  it("renders with Spanish locale", async () => {
    __seedInvoice(BASE_INVOICE);

    const res = await request(app)
      .get(`/invoices/${INV_ID}/pdf?locale=es`)
      .set("x-user-id", ISSUER)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks).toString("utf8")));
      });

    expect(res.text).toContain("Factura");
    expect(res.text).toContain("Total");
  });

  it("falls back to English for unsupported locale", async () => {
    __seedInvoice(BASE_INVOICE);

    const res = await request(app)
      .get(`/invoices/${INV_ID}/pdf?locale=zh`)
      .set("x-user-id", ISSUER)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks).toString("utf8")));
      });

    expect(res.text).toContain("Invoice");
  });

  // --- unauthorized ---

  it("rejects caller who is neither issuer nor payer", async () => {
    __seedInvoice(BASE_INVOICE);

    const res = await request(app)
      .get(`/invoices/${INV_ID}/pdf`)
      .set("x-user-id", OTHER);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects unauthenticated request", async () => {
    __seedInvoice(BASE_INVOICE);

    const res = await request(app).get(`/invoices/${INV_ID}/pdf`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects when invoice is not found", async () => {
    const res = await request(app)
      .get("/invoices/nonexistent/pdf")
      .set("x-user-id", ISSUER);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
