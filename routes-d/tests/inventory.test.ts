import express, { type Express } from "express";
import request from "supertest";
import {
  clearInventory,
  confirmReservation,
  getProductStock,
  getReservation,
  InsufficientStockError,
  reapExpiredReservations,
  releaseReservation,
  reserveStock,
  returnStock,
  setProductStock,
  withStockReservation,
} from "../lib/inventory.js";
import {
  createOrdersCancelRouter,
  type CancelableOrderRecord,
  type CancelOrderStore,
} from "../routes/orders.cancel.js";
import { createOrdersCreateRouter, type CreateOrderRecord, type CreateOrderStore } from "../routes/orders.create.js";

beforeEach(() => {
  clearInventory();
});

describe("inventory reservations", () => {
  it("reserves stock atomically", () => {
    setProductStock("sku-1", 10);
    const reservation = reserveStock("sku-1", 3);
    expect(reservation.productId).toBe("sku-1");
    expect(getProductStock("sku-1")?.reserved).toBe(3);
    expect(getProductStock("sku-1")?.available).toBe(10);
  });

  it("releases reservation and restores reserved count", () => {
    setProductStock("sku-1", 10);
    const reservation = reserveStock("sku-1", 4);
    expect(releaseReservation(reservation.reservationId)).toBe(true);
    expect(getProductStock("sku-1")?.reserved).toBe(0);
    expect(getReservation(reservation.reservationId)).toBeUndefined();
  });

  it("rejects concurrent reservations beyond available stock", () => {
    setProductStock("sku-1", 5);
    reserveStock("sku-1", 4);
    expect(() => reserveStock("sku-1", 2)).toThrow(InsufficientStockError);
  });

  it("reaps expired reservations", () => {
    setProductStock("sku-1", 10);
    const reservation = reserveStock("sku-1", 2, { timeoutMs: 10, now: () => 1000 });
    expect(getReservation(reservation.reservationId, 1000)).toBeDefined();
    reapExpiredReservations(1011);
    expect(getReservation(reservation.reservationId, 1011)).toBeUndefined();
    expect(getProductStock("sku-1")?.reserved).toBe(0);
  });

  it("confirms reservation by deducting available stock", () => {
    setProductStock("sku-1", 8);
    const reservation = reserveStock("sku-1", 3);
    confirmReservation(reservation.reservationId);
    expect(getProductStock("sku-1")).toMatchObject({ available: 5, reserved: 0 });
  });

  it("returns stock after cancellation", () => {
    setProductStock("sku-1", 2);
    returnStock("sku-1", 2);
    expect(getProductStock("sku-1")?.available).toBe(4);
  });

  it("withStockReservation releases on failure", async () => {
    setProductStock("sku-1", 5);
    await expect(
      withStockReservation("sku-1", 2, async () => {
        throw new Error("order failed");
      }),
    ).rejects.toThrow("order failed");
    expect(getProductStock("sku-1")?.reserved).toBe(0);
  });
});

function buildCreateStore(): CreateOrderStore {
  const map = new Map<string, CreateOrderRecord>();
  return {
    async get(id) {
      return map.get(id);
    },
    async save(order) {
      map.set(order.id, order);
    },
  };
}

function buildCancelStore(initial: CancelableOrderRecord[] = []): CancelOrderStore {
  const map = new Map<string, CancelableOrderRecord>(initial.map((order) => [order.id, order]));
  return {
    async get(id) {
      return map.get(id);
    },
    async save(order) {
      map.set(order.id, order);
    },
  };
}

function buildCreateApp(store: CreateOrderStore): Express {
  const app = express();
  app.use(express.json());
  app.use("/orders", createOrdersCreateRouter({ store, now: () => 1000, nextId: () => "order-1" }));
  return app;
}

function buildCancelApp(store: CancelOrderStore): Express {
  const app = express();
  app.use(express.json());
  app.use("/orders", createOrdersCancelRouter({ store, now: () => 2000 }));
  return app;
}

describe("orders create/cancel inventory integration", () => {
  it("creates an order when stock is available", async () => {
    setProductStock("widget", 5);
    const res = await request(buildCreateApp(buildCreateStore()))
      .post("/orders")
      .send({ customer: "alice", productId: "widget", quantity: 2, amount: 20 });
    expect(res.status).toBe(201);
    expect(getProductStock("widget")).toMatchObject({ available: 3, reserved: 0 });
  });

  it("rejects order creation when stock is insufficient", async () => {
    setProductStock("widget", 1);
    const res = await request(buildCreateApp(buildCreateStore()))
      .post("/orders")
      .send({ customer: "alice", productId: "widget", quantity: 2, amount: 20 });
    expect(res.status).toBe(409);
    expect(getProductStock("widget")?.reserved).toBe(0);
  });

  it("returns stock when a cancellable order is cancelled", async () => {
    setProductStock("widget", 2);
    const store = buildCancelStore([
      { id: "1", status: "pending", updatedAt: 0, productId: "widget", quantity: 2 },
    ]);
    const res = await request(buildCancelApp(store)).post("/orders/1/cancel");
    expect(res.status).toBe(200);
    expect(getProductStock("widget")?.available).toBe(4);
  });
});
