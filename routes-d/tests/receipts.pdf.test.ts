import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import receiptPdfRouter, {
  __resetTransactions,
  __seedTransaction,
} from "../routes/receipts.pdf.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(receiptPdfRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const OWNER_ID = "user-123";
const OTHER_ID = "user-999";
const TX_ID = "tx-receipt-001";

const COMPLETED_TX = {
  id: TX_ID,
  userId: OWNER_ID,
  amount: "500.00",
  currency: "USDC",
  status: "completed" as const,
  type: "payment",
  createdAt: "2024-06-01T10:00:00Z",
  completedAt: "2024-06-01T10:02:00Z",
  stellarTxHash: "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef",
  sender: OWNER_ID,
  recipient: "user-456",
  fee: "0.01",
  memo: "Invoice payment #1001",
};

const PENDING_TX = {
  ...COMPLETED_TX,
  id: "tx-receipt-pending",
  status: "pending" as const,
};

describe("GET /receipts/:id/pdf", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetTransactions();
  });

  it("returns a PDF receipt for a completed transaction", async () => {
    __seedTransaction(COMPLETED_TX);

    const res = await request(app)
      .get(`/receipts/${TX_ID}/pdf`)
      .set("x-user-id", OWNER_ID);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toContain(`receipt-${TX_ID}.pdf`);
    expect(res.headers["content-length"]).toBeDefined();
  });

  it("streams PDF body containing transaction ID and amount", async () => {
    __seedTransaction(COMPLETED_TX);

    const res = await request(app)
      .get(`/receipts/${TX_ID}/pdf`)
      .set("x-user-id", OWNER_ID)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks).toString("utf8")));
      });

    const bodyText = (res.text ?? res.body ?? "").toString();
    expect(bodyText).toContain(TX_ID);
    expect(bodyText).toContain("500.00 USDC");
    expect(bodyText).toContain("completed");
  });

  it("supports locale switching via query param", async () => {
    __seedTransaction(COMPLETED_TX);

    const resEs = await request(app)
      .get(`/receipts/${TX_ID}/pdf?locale=es`)
      .set("x-user-id", OWNER_ID)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks).toString("utf8")));
      });

    const textEs = (resEs.text ?? resEs.body ?? "").toString();
    expect(textEs).toContain("RECIBO DE TRANSACCIÓN");
    expect(textEs).toContain("Monto");

    const resFr = await request(app)
      .get(`/receipts/${TX_ID}/pdf?locale=fr`)
      .set("x-user-id", OWNER_ID)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks).toString("utf8")));
      });

    const textFr = (resFr.text ?? resFr.body ?? "").toString();
    expect(textFr).toContain("REÇU DE TRANSACTION");
    expect(textFr).toContain("Montant");
  });

  it("falls back to default English for invalid locale query param", async () => {
    __seedTransaction(COMPLETED_TX);

    const res = await request(app)
      .get(`/receipts/${TX_ID}/pdf?locale=invalid_lang`)
      .set("x-user-id", OWNER_ID)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks).toString("utf8")));
      });

    const text = (res.text ?? res.body ?? "").toString();
    expect(text).toContain("TRANSACTION RECEIPT");
  });

  it("rejects request missing x-user-id header with 401 UNAUTHORIZED", async () => {
    __seedTransaction(COMPLETED_TX);

    const res = await request(app).get(`/receipts/${TX_ID}/pdf`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects request from unauthorized user with 403 FORBIDDEN", async () => {
    __seedTransaction(COMPLETED_TX);

    const res = await request(app)
      .get(`/receipts/${TX_ID}/pdf`)
      .set("x-user-id", OTHER_ID);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 NOT_FOUND for non-existent transaction", async () => {
    const res = await request(app)
      .get("/receipts/non-existent-id/pdf")
      .set("x-user-id", OWNER_ID);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 409 CONFLICT for non-completed transaction", async () => {
    __seedTransaction(PENDING_TX);

    const res = await request(app)
      .get(`/receipts/${PENDING_TX.id}/pdf`)
      .set("x-user-id", OWNER_ID);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TRANSACTION_NOT_COMPLETED");
  });
});
