import request from "supertest";
import express from "express";
import checkoutRouter, {
  seedInventory,
  getOrders,
  resetCheckoutState,
} from "../routes/checkout.js";
import { globalErrorHandler } from "../middleware/errorHandler.js";

const ORIGINAL_ENV = process.env;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/checkout", checkoutRouter);
  app.use(globalErrorHandler);
  return app;
}

const BASE_ITEMS = [
  { productId: "prod-1", quantity: 2, price: 10 },
  { productId: "prod-2", quantity: 1, price: 25 },
];

describe("POST /checkout", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    resetCheckoutState();
    seedInventory({ "prod-1": 10, "prod-2": 5 });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it("returns 201 with orderId and total on success", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/checkout")
      .send({ userId: "user-1", items: BASE_ITEMS });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orderId).toBeDefined();
    expect(res.body.data.total).toBe(45);
  });

  it("persists the order when all three steps succeed", async () => {
    const app = buildApp();
    await request(app)
      .post("/checkout")
      .send({ userId: "user-1", items: BASE_ITEMS });

    expect(getOrders()).toHaveLength(1);
    expect(getOrders()[0]?.userId).toBe("user-1");
  });

  it("deducts inventory when all three steps succeed", async () => {
    const app = buildApp();
    await request(app)
      .post("/checkout")
      .send({ userId: "user-1", items: BASE_ITEMS });

    // We can observe rollback behaviour via a second call with depleted stock
    const res2 = await request(app)
      .post("/checkout")
      .send({
        userId: "user-1",
        items: [{ productId: "prod-2", quantity: 5, price: 25 }],
      });
    expect(res2.status).toBe(500); // only 4 left after first checkout
  });

  // ── Payment failure → full rollback ────────────────────────────────────────

  it("rolls back order and inventory when payment fails", async () => {
    process.env.SIMULATE_PAYMENT_FAILURE = "true";
    const app = buildApp();

    const res = await request(app)
      .post("/checkout")
      .send({ userId: "user-1", items: BASE_ITEMS });

    expect(res.status).toBe(500);

    // Order must not exist
    expect(getOrders()).toHaveLength(0);
  });

  it("leaves inventory unchanged when payment fails", async () => {
    process.env.SIMULATE_PAYMENT_FAILURE = "true";
    const app = buildApp();

    await request(app)
      .post("/checkout")
      .send({ userId: "user-1", items: BASE_ITEMS });

    // A subsequent successful checkout must still be able to deduct stock
    process.env.SIMULATE_PAYMENT_FAILURE = undefined as unknown as string;
    delete process.env.SIMULATE_PAYMENT_FAILURE;

    const res = await request(app)
      .post("/checkout")
      .send({ userId: "user-1", items: BASE_ITEMS });

    expect(res.status).toBe(201);
    expect(getOrders()).toHaveLength(1);
  });

  // ── Insufficient stock ─────────────────────────────────────────────────────

  it("returns 500 and does not create an order when stock is insufficient", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/checkout")
      .send({
        userId: "user-1",
        items: [{ productId: "prod-1", quantity: 99, price: 10 }],
      });

    expect(res.status).toBe(500);
    expect(getOrders()).toHaveLength(0);
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  it("returns 400 when userId is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/checkout")
      .send({ items: BASE_ITEMS });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when items array is empty", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/checkout")
      .send({ userId: "user-1", items: [] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when items is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/checkout")
      .send({ userId: "user-1" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
