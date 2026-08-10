import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __getExpenses,
  __resetExpenses,
  __seedExpense,
} from "../routes/lancepay.expenses.create.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const VALID_BODY = {
  contractorId: "con-1",
  category: "travel",
  currency: "USD",
  amount: 250,
  receiptId: "rcpt-abc123",
};

describe("POST /lancepay/expenses", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetExpenses();
  });

  it("submits an expense with valid data", async () => {
    const res = await request(app)
      .post("/lancepay/expenses")
      .set("x-user-id", "con-1")
      .send(VALID_BODY);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("id");
    expect(res.body.data.status).toBe("submitted");
    expect(res.body.data.currency).toBe("USD");
    expect(res.body.data.category).toBe("travel");
  });

  it("returns 401 when x-user-id header is missing", async () => {
    const res = await request(app).post("/lancepay/expenses").send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 when contractorId does not match caller", async () => {
    const res = await request(app)
      .post("/lancepay/expenses")
      .set("x-user-id", "con-2")
      .send(VALID_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 400 when category is invalid", async () => {
    const res = await request(app)
      .post("/lancepay/expenses")
      .set("x-user-id", "con-1")
      .send({ ...VALID_BODY, category: "invalid_cat" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CATEGORY");
  });

  it("returns 400 when currency is unsupported", async () => {
    const res = await request(app)
      .post("/lancepay/expenses")
      .set("x-user-id", "con-1")
      .send({ ...VALID_BODY, currency: "ZZZ" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CURRENCY");
  });

  it("returns 400 when amount is missing", async () => {
    const { amount: _a, ...rest } = VALID_BODY;
    const res = await request(app)
      .post("/lancepay/expenses")
      .set("x-user-id", "con-1")
      .send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 when amount is zero", async () => {
    const res = await request(app)
      .post("/lancepay/expenses")
      .set("x-user-id", "con-1")
      .send({ ...VALID_BODY, amount: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 when amount exceeds limit", async () => {
    const res = await request(app)
      .post("/lancepay/expenses")
      .set("x-user-id", "con-1")
      .send({ ...VALID_BODY, amount: 15_000 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("AMOUNT_EXCEEDS_LIMIT");
  });

  it("returns 400 when receiptId is missing", async () => {
    const { receiptId: _r, ...rest } = VALID_BODY;
    const res = await request(app)
      .post("/lancepay/expenses")
      .set("x-user-id", "con-1")
      .send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_RECEIPT");
  });

  it("normalises category to lowercase", async () => {
    const res = await request(app)
      .post("/lancepay/expenses")
      .set("x-user-id", "con-1")
      .send({ ...VALID_BODY, category: "TRAVEL" });
    expect(res.status).toBe(201);
    expect(res.body.data.category).toBe("travel");
  });

  it("normalises currency to uppercase", async () => {
    const res = await request(app)
      .post("/lancepay/expenses")
      .set("x-user-id", "con-1")
      .send({ ...VALID_BODY, currency: "eur" });
    expect(res.status).toBe(201);
    expect(res.body.data.currency).toBe("EUR");
  });

  it("includes optional description", async () => {
    const res = await request(app)
      .post("/lancepay/expenses")
      .set("x-user-id", "con-1")
      .send({ ...VALID_BODY, description: "Flight to conference" });
    expect(res.status).toBe(201);
    expect(res.body.data.description).toBe("Flight to conference");
  });
});
