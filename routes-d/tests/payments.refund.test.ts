// Tests for the failed-payment refund endpoint (#294).
//
// Covers the happy path, idempotent replay (single dispatcher call
// across multiple HTTP attempts), unauthorised access, double-refund
// rejection via state, and dispatcher failures.

import express, { type Express } from "express";
import request from "supertest";
import {
  type PaymentRecord,
  type PaymentStore,
  type RefundDispatcher,
  type RefundRecord,
  type RefundStore,
  createRefundRouter,
} from "../routes/payments.refund.js";

function buildPaymentStore(initial: PaymentRecord[] = []): PaymentStore & {
  inspect(): Map<string, PaymentRecord>;
} {
  const map = new Map<string, PaymentRecord>(initial.map((p) => [p.id, p]));
  return {
    async get(id) {
      return map.get(id);
    },
    async markRefunded(id) {
      const p = map.get(id);
      if (p) map.set(id, { ...p, status: "refunded" });
    },
    inspect: () => map,
  };
}

function buildRefundStore(): RefundStore & { inspect(): RefundRecord[] } {
  const list: RefundRecord[] = [];
  return {
    async findByIdempotency(paymentId, idempotencyKey) {
      return list.find(
        (r) => r.paymentId === paymentId && r.idempotencyKey === idempotencyKey,
      );
    },
    async save(refund) {
      list.push(refund);
    },
    inspect: () => list,
  };
}

function buildApp(
  payments: PaymentStore,
  refunds: RefundStore,
  dispatcher: RefundDispatcher,
): Express {
  const app = express();
  app.use(express.json());
  app.use(
    "/payments",
    createRefundRouter({
      payments,
      refunds,
      dispatcher,
      now: () => 5000,
      newRefundId: () => "rf_fixed",
    }),
  );
  return app;
}

describe("POST /payments/:id/refund", () => {
  const failed: PaymentRecord = {
    id: "p1",
    payerId: "alice",
    amount: 100,
    currency: "USDC",
    status: "failed",
  };

  it("refunds a failed payment on the happy path", async () => {
    const payments = buildPaymentStore([failed]);
    const refunds = buildRefundStore();
    const refund = jest.fn().mockResolvedValue({ refundId: "prov_1" });
    const app = buildApp(payments, refunds, { refund });

    const res = await request(app)
      .post("/payments/p1/refund")
      .send({ requesterId: "alice", requesterRole: "user" });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.idempotent).toBe(false);
    expect(res.body.refund).toMatchObject({
      refundId: "prov_1",
      paymentId: "p1",
      amount: 100,
      currency: "USDC",
      createdAt: 5000,
    });
    expect(refund).toHaveBeenCalledTimes(1);
    expect(payments.inspect().get("p1")?.status).toBe("refunded");
    expect(refunds.inspect()).toHaveLength(1);
  });

  it("is idempotent against duplicate refund requests", async () => {
    const payments = buildPaymentStore([failed]);
    const refunds = buildRefundStore();
    const refund = jest.fn().mockResolvedValue({ refundId: "prov_dup" });
    const app = buildApp(payments, refunds, { refund });

    const first = await request(app)
      .post("/payments/p1/refund")
      .send({ requesterId: "alice", requesterRole: "user", idempotencyKey: "key-1" });
    const second = await request(app)
      .post("/payments/p1/refund")
      .send({ requesterId: "alice", requesterRole: "user", idempotencyKey: "key-1" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
    expect(second.body.refund).toEqual(first.body.refund);
    // The dispatcher must only have been called once across both attempts.
    expect(refund).toHaveBeenCalledTimes(1);
    expect(refunds.inspect()).toHaveLength(1);
  });

  it("rejects a refund from a non-payer non-admin requester", async () => {
    const payments = buildPaymentStore([failed]);
    const refunds = buildRefundStore();
    const refund = jest.fn();
    const app = buildApp(payments, refunds, { refund });

    const res = await request(app)
      .post("/payments/p1/refund")
      .send({ requesterId: "mallory", requesterRole: "user" });

    expect(res.status).toBe(403);
    expect(refund).not.toHaveBeenCalled();
    expect(refunds.inspect()).toHaveLength(0);
  });

  it("allows admins to refund on behalf of the payer", async () => {
    const payments = buildPaymentStore([failed]);
    const refunds = buildRefundStore();
    const refund = jest.fn().mockResolvedValue({ refundId: "prov_admin" });
    const app = buildApp(payments, refunds, { refund });

    const res = await request(app)
      .post("/payments/p1/refund")
      .send({ requesterId: "ops", requesterRole: "admin" });

    expect(res.status).toBe(201);
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when payment is in a non-refundable status", async () => {
    const pending: PaymentRecord = { ...failed, status: "pending" };
    const payments = buildPaymentStore([pending]);
    const refunds = buildRefundStore();
    const refund = jest.fn();
    const app = buildApp(payments, refunds, { refund });

    const res = await request(app)
      .post("/payments/p1/refund")
      .send({ requesterId: "alice", requesterRole: "user" });

    expect(res.status).toBe(409);
    expect(res.body.status).toBe("pending");
    expect(refund).not.toHaveBeenCalled();
  });

  it("returns 409 when payment is already refunded", async () => {
    const already: PaymentRecord = { ...failed, status: "refunded" };
    const payments = buildPaymentStore([already]);
    const refunds = buildRefundStore();
    const refund = jest.fn();
    const app = buildApp(payments, refunds, { refund });

    const res = await request(app)
      .post("/payments/p1/refund")
      .send({ requesterId: "alice", requesterRole: "user" });

    // Without a prior idempotency record, a fully-refunded payment must
    // not be refunded a second time.
    expect(res.status).toBe(409);
    expect(refund).not.toHaveBeenCalled();
  });

  it("returns 404 when payment does not exist", async () => {
    const app = buildApp(buildPaymentStore(), buildRefundStore(), {
      refund: jest.fn(),
    });
    const res = await request(app)
      .post("/payments/missing/refund")
      .send({ requesterId: "alice", requesterRole: "user" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when requester fields are missing", async () => {
    const app = buildApp(buildPaymentStore([failed]), buildRefundStore(), {
      refund: jest.fn(),
    });
    const res = await request(app).post("/payments/p1/refund").send({});
    expect(res.status).toBe(400);
  });

  it("returns 502 when dispatcher throws", async () => {
    const payments = buildPaymentStore([failed]);
    const refunds = buildRefundStore();
    const refund = jest.fn().mockRejectedValue(new Error("network"));
    const app = buildApp(payments, refunds, { refund });

    const res = await request(app)
      .post("/payments/p1/refund")
      .send({ requesterId: "alice", requesterRole: "user" });

    expect(res.status).toBe(502);
    expect(refunds.inspect()).toHaveLength(0);
    expect(payments.inspect().get("p1")?.status).toBe("failed");
  });
});
