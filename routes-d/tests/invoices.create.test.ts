import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import invoiceCreateRouter, {
  __resetInvoiceStore,
  __seedInvoice,
} from "../routes/invoices.create.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(invoiceCreateRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const app = buildApp();

const BASE_BODY = {
  currency: "USD",
  recipientId: "recipient-001",
  lineItems: [
    { description: "Web design", quantity: 1, unitPrice: 500 },
    { description: "Hosting", quantity: 12, unitPrice: 20 },
  ],
};

beforeEach(() => {
  __resetInvoiceStore();
});

describe("POST /invoices – create", () => {
  it("creates an invoice and returns payable link", async () => {
    const res = await request(app)
      .post("/invoices")
      .set("x-user-id", "issuer-1")
      .send(BASE_BODY);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toMatch(/^inv-/);
    expect(res.body.data.status).toBe("pending");
    expect(res.body.data.currency).toBe("USD");
    expect(res.body.data.recipientId).toBe("recipient-001");
    expect(res.body.data.payableLink).toContain(res.body.data.id);
    expect(res.body.data.totalAmount).toBe(740); // 500 + 12*20
    expect(res.body.data.lineItems).toHaveLength(2);
  });

  it("computes totalAmount correctly for each line item", async () => {
    const res = await request(app)
      .post("/invoices")
      .set("x-user-id", "issuer-1")
      .send({
        ...BASE_BODY,
        lineItems: [
          { description: "Item A", quantity: 3, unitPrice: 100 },
          { description: "Item B", quantity: 2, unitPrice: 50 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.totalAmount).toBe(400); // 300 + 100
    expect(res.body.data.lineItems[0].amount).toBe(300);
    expect(res.body.data.lineItems[1].amount).toBe(100);
  });
});

describe("POST /invoices – validation failures", () => {
  it("rejects missing x-user-id", async () => {
    const res = await request(app).post("/invoices").send(BASE_BODY);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects missing currency", async () => {
    const { currency: _, ...body } = BASE_BODY;
    const res = await request(app)
      .post("/invoices")
      .set("x-user-id", "issuer-1")
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CURRENCY");
  });

  it("rejects invalid currency", async () => {
    const res = await request(app)
      .post("/invoices")
      .set("x-user-id", "issuer-1")
      .send({ ...BASE_BODY, currency: "GBP" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CURRENCY");
  });

  it("rejects missing recipientId", async () => {
    const { recipientId: _, ...body } = BASE_BODY;
    const res = await request(app)
      .post("/invoices")
      .set("x-user-id", "issuer-1")
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_RECIPIENT");
  });

  it("rejects recipientId equal to issuerId", async () => {
    const res = await request(app)
      .post("/invoices")
      .set("x-user-id", "user-same")
      .send({ ...BASE_BODY, recipientId: "user-same" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_RECIPIENT");
  });

  it("rejects empty lineItems array", async () => {
    const res = await request(app)
      .post("/invoices")
      .set("x-user-id", "issuer-1")
      .send({ ...BASE_BODY, lineItems: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_LINE_ITEMS");
  });

  it("rejects lineItems with missing description", async () => {
    const res = await request(app)
      .post("/invoices")
      .set("x-user-id", "issuer-1")
      .send({
        ...BASE_BODY,
        lineItems: [{ quantity: 1, unitPrice: 100 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_LINE_ITEM");
  });

  it("rejects lineItems with non-positive quantity", async () => {
    const res = await request(app)
      .post("/invoices")
      .set("x-user-id", "issuer-1")
      .send({
        ...BASE_BODY,
        lineItems: [{ description: "X", quantity: 0, unitPrice: 10 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_LINE_ITEM");
  });

  it("rejects lineItems with negative unitPrice", async () => {
    const res = await request(app)
      .post("/invoices")
      .set("x-user-id", "issuer-1")
      .send({
        ...BASE_BODY,
        lineItems: [{ description: "X", quantity: 1, unitPrice: -5 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_LINE_ITEM");
  });
});

describe("POST /invoices – idempotency", () => {
  it("returns same invoice for duplicate idempotency key", async () => {
    const body = { ...BASE_BODY, idempotencyKey: "idem-key-abc" };

    const first = await request(app)
      .post("/invoices")
      .set("x-user-id", "issuer-1")
      .send(body);

    expect(first.status).toBe(201);
    const firstId = first.body.data.id;

    const second = await request(app)
      .post("/invoices")
      .set("x-user-id", "issuer-1")
      .send(body);

    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(firstId);
  });

  it("creates distinct invoices for different idempotency keys", async () => {
    const first = await request(app)
      .post("/invoices")
      .set("x-user-id", "issuer-1")
      .send({ ...BASE_BODY, idempotencyKey: "key-1" });

    const second = await request(app)
      .post("/invoices")
      .set("x-user-id", "issuer-1")
      .send({ ...BASE_BODY, idempotencyKey: "key-2" });

    expect(first.body.data.id).not.toBe(second.body.data.id);
  });
});
