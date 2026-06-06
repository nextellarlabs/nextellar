import express, { type Express } from "express";
import request from "supertest";
import { createOrdersCancelRouter, type CancelableOrderRecord, type CancelOrderStore } from "../routes/orders.cancel.js";

function buildStore(initial: CancelableOrderRecord[] = []): CancelOrderStore {
  const map = new Map<string, CancelableOrderRecord>(initial.map((o) => [o.id, o]));
  return {
    async get(id) {
      return map.get(id);
    },
    async save(order) {
      map.set(order.id, order);
    },
  };
}

function buildApp(store: CancelOrderStore, hooks: { onCancel?: jest.Mock; onRefund?: jest.Mock } = {}): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/orders",
    createOrdersCancelRouter({
      store,
      now: () => 1000,
      onCancel: hooks.onCancel,
      onRefund: hooks.onRefund,
    }),
  );
  return app;
}

describe("POST /orders/:id/cancel", () => {
  it("cancels a pending order without refund", async () => {
    const store = buildStore([{ id: "1", status: "pending", updatedAt: 0 }]);
    const onCancel = jest.fn();
    const onRefund = jest.fn();
    const res = await request(buildApp(store, { onCancel, onRefund })).post("/orders/1/cancel");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, refunded: false, order: { id: "1", status: "cancelled", updatedAt: 1000 } });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRefund).not.toHaveBeenCalled();
  });

  it("triggers refund flow when payment was already captured", async () => {
    const store = buildStore([{ id: "1", status: "paid", updatedAt: 0, paymentCaptured: true }]);
    const onRefund = jest.fn();
    const res = await request(buildApp(store, { onRefund })).post("/orders/1/cancel");

    expect(res.status).toBe(200);
    expect(res.body.refunded).toBe(true);
    expect(onRefund).toHaveBeenCalledTimes(1);
  });

  it("rejects cancellation from an illegal terminal state", async () => {
    const store = buildStore([{ id: "1", status: "cancelled", updatedAt: 0 }]);
    const res = await request(buildApp(store)).post("/orders/1/cancel");

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/terminal/);
  });

  it("returns 404 when the order does not exist", async () => {
    const res = await request(buildApp(buildStore())).post("/orders/missing/cancel");
    expect(res.status).toBe(404);
  });
});
