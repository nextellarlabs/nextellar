// Tests for the order status state machine (#297). Covers every legal
// transition and every illegal one — the matrix is small enough to
// enumerate exhaustively.

import express, { type Express } from "express";
import request from "supertest";
import {
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  type OrderStatus,
  assertTransition,
  isTerminal,
  validateTransition,
  IllegalTransitionError,
} from "../lib/orderStateMachine.js";
import { createOrdersUpdateRouter, type OrderRecord, type OrderStore } from "../routes/orders.update.js";

describe("orderStateMachine — pure validation", () => {
  it("allows every transition listed in ORDER_TRANSITIONS", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_TRANSITIONS[from]) {
        expect(validateTransition(from, to)).toEqual({ ok: true });
      }
    }
  });

  it("rejects every transition NOT listed in ORDER_TRANSITIONS", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        if (from === to) continue;
        if (ORDER_TRANSITIONS[from].includes(to)) continue;
        const result = validateTransition(from, to);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/illegal transition|terminal/);
      }
    }
  });

  it("rejects same-status transitions", () => {
    for (const s of ORDER_STATUSES) {
      const r = validateTransition(s, s);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/already in/);
    }
  });

  it("flags terminal statuses correctly", () => {
    expect(isTerminal("delivered" as OrderStatus)).toBe(false);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("refunded")).toBe(true);
    // delivered → refunded is legal, so delivered isn't strictly
    // terminal in the lifecycle sense; the helper reflects the
    // transitions-map definition.
    expect(ORDER_TRANSITIONS.cancelled).toHaveLength(0);
  });

  it("assertTransition throws IllegalTransitionError on bad transitions", () => {
    expect(() => assertTransition("pending", "delivered")).toThrow(IllegalTransitionError);
    try {
      assertTransition("pending", "delivered");
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalTransitionError);
      const e = err as IllegalTransitionError;
      expect(e.from).toBe("pending");
      expect(e.to).toBe("delivered");
    }
  });
});

function buildStore(initial: OrderRecord[] = []): OrderStore {
  const map = new Map<string, OrderRecord>(initial.map((o) => [o.id, o]));
  return {
    async get(id) {
      return map.get(id);
    },
    async save(order) {
      map.set(order.id, order);
    },
  };
}

function buildApp(store: OrderStore, hooks: { onTransition?: jest.Mock } = {}): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/orders",
    createOrdersUpdateRouter({
      store,
      now: () => 1000,
      onTransition: hooks.onTransition,
    }),
  );
  return app;
}

describe("PATCH /orders/:id/status — wired through the state machine", () => {
  it("allows pending → paid", async () => {
    const store = buildStore([{ id: "1", status: "pending", updatedAt: 0 }]);
    const res = await request(buildApp(store)).patch("/orders/1/status").send({ status: "paid" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, order: { id: "1", status: "paid", updatedAt: 1000 } });
  });

  it("rejects pending → shipped with 409", async () => {
    const store = buildStore([{ id: "1", status: "pending", updatedAt: 0 }]);
    const res = await request(buildApp(store)).patch("/orders/1/status").send({ status: "shipped" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ok: false, from: "pending", to: "shipped" });
    expect(res.body.error).toMatch(/illegal transition/);
  });

  it("rejects shipped → paid (reverse) with 409", async () => {
    const store = buildStore([{ id: "1", status: "shipped", updatedAt: 0 }]);
    const res = await request(buildApp(store)).patch("/orders/1/status").send({ status: "paid" });
    expect(res.status).toBe(409);
  });

  it("rejects updates on terminal orders (cancelled) with 409", async () => {
    const store = buildStore([{ id: "1", status: "cancelled", updatedAt: 0 }]);
    const res = await request(buildApp(store)).patch("/orders/1/status").send({ status: "paid" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/terminal/);
  });

  it("returns 404 when the order does not exist", async () => {
    const store = buildStore();
    const res = await request(buildApp(store)).patch("/orders/missing/status").send({ status: "paid" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when status is missing or invalid", async () => {
    const store = buildStore([{ id: "1", status: "pending", updatedAt: 0 }]);
    const r1 = await request(buildApp(store)).patch("/orders/1/status").send({});
    expect(r1.status).toBe(400);
    const r2 = await request(buildApp(store)).patch("/orders/1/status").send({ status: "wat" });
    expect(r2.status).toBe(400);
  });

  it("fires onTransition exactly once per successful update", async () => {
    const onTransition = jest.fn();
    const store = buildStore([{ id: "1", status: "pending", updatedAt: 0 }]);
    await request(buildApp(store, { onTransition }))
      .patch("/orders/1/status")
      .send({ status: "paid" });
    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(onTransition.mock.calls[0][1]).toBe("pending");
  });

  it("does NOT fire onTransition for illegal transitions", async () => {
    const onTransition = jest.fn();
    const store = buildStore([{ id: "1", status: "pending", updatedAt: 0 }]);
    await request(buildApp(store, { onTransition }))
      .patch("/orders/1/status")
      .send({ status: "delivered" });
    expect(onTransition).not.toHaveBeenCalled();
  });
});
