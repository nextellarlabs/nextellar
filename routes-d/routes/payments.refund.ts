// POST /payments/:id/refund — refund a failed Nextellar payment by
// initiating a reverse transfer (#294).
//
// Rules:
//   1. The original payment must exist and be in a refundable state
//      (`failed` or `captured`, never `pending` or `refunded`).
//   2. The request is *idempotent*: a caller can retry safely. We key
//      idempotency on `(paymentId, idempotencyKey)` where the key
//      defaults to the payment id. The first successful refund is
//      remembered and subsequent calls return it unchanged.
//   3. Only the original payer (or an admin) can request the refund —
//      callers must supply a `requesterId`; the route returns 403 if it
//      mismatches `payment.payerId` unless `requesterRole === "admin"`.
//
// Persistence is pluggable via `PaymentStore` and `RefundStore` so the
// route is testable in isolation.

import { Router, type Request, type Response } from "express";

export type PaymentStatus = "pending" | "captured" | "failed" | "refunded";

export interface PaymentRecord {
  id: string;
  payerId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
}

export interface RefundRecord {
  refundId: string;
  paymentId: string;
  amount: number;
  currency: string;
  createdAt: number;
  /** Echoes the idempotency key that produced this refund. */
  idempotencyKey: string;
}

export interface PaymentStore {
  get(id: string): Promise<PaymentRecord | undefined>;
  /** Mark the payment refunded in the same atomic step as the refund
   *  record write — implementations may use a transaction. */
  markRefunded(id: string): Promise<void>;
}

export interface RefundStore {
  /** Returns an existing refund for the (paymentId, idempotencyKey)
   *  tuple, or undefined when this is the first attempt. */
  findByIdempotency(paymentId: string, idempotencyKey: string): Promise<RefundRecord | undefined>;
  save(refund: RefundRecord): Promise<void>;
}

export interface RefundDispatcher {
  /** Issue the actual reverse transfer. Returns the provider-side id
   *  used as `refundId`. May throw to indicate a transient failure;
   *  the route translates that into a 502. */
  refund(payment: PaymentRecord): Promise<{ refundId: string }>;
}

export interface RefundRouterOptions {
  payments: PaymentStore;
  refunds: RefundStore;
  dispatcher: RefundDispatcher;
  now?: () => number;
  /** Generate a refund id when the dispatcher does not. Defaults to a
   *  timestamp-based id; tests inject a deterministic generator. */
  newRefundId?: () => string;
}

/** Statuses that may transition to `refunded`. */
const REFUNDABLE_STATUSES: ReadonlySet<PaymentStatus> = new Set(["failed", "captured"]);

interface RefundRequestBody {
  requesterId?: unknown;
  requesterRole?: unknown;
  idempotencyKey?: unknown;
}

function readBody(body: unknown): {
  requesterId: string;
  requesterRole: string;
  idempotencyKey?: string;
} | null {
  if (!body || typeof body !== "object") return null;
  const b = body as RefundRequestBody;
  if (typeof b.requesterId !== "string" || b.requesterId.trim() === "") return null;
  if (typeof b.requesterRole !== "string" || b.requesterRole.trim() === "") return null;
  const idempotencyKey =
    typeof b.idempotencyKey === "string" && b.idempotencyKey.trim() !== ""
      ? b.idempotencyKey.trim()
      : undefined;
  return {
    requesterId: b.requesterId.trim(),
    requesterRole: b.requesterRole.trim(),
    idempotencyKey,
  };
}

export function createRefundRouter(opts: RefundRouterOptions): Router {
  const router = Router();
  const now = opts.now ?? Date.now;
  const newRefundId = opts.newRefundId ?? (() => `rf_${now()}`);

  router.post("/:id/refund", async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const parsed = readBody(req.body);
    if (!parsed) {
      res.status(400).json({
        ok: false,
        error: "requesterId and requesterRole are required",
      });
      return;
    }

    const payment = await opts.payments.get(id);
    if (!payment) {
      res.status(404).json({ ok: false, error: `payment ${id} not found` });
      return;
    }

    const isAdmin = parsed.requesterRole === "admin";
    if (!isAdmin && parsed.requesterId !== payment.payerId) {
      res.status(403).json({ ok: false, error: "not authorised to refund this payment" });
      return;
    }

    const idempotencyKey = parsed.idempotencyKey ?? payment.id;
    const existing = await opts.refunds.findByIdempotency(payment.id, idempotencyKey);
    if (existing) {
      // Idempotent replay — return the original refund unchanged.
      res.status(200).json({ ok: true, refund: existing, idempotent: true });
      return;
    }

    if (!REFUNDABLE_STATUSES.has(payment.status)) {
      res.status(409).json({
        ok: false,
        error: `payment in status '${payment.status}' is not refundable`,
        status: payment.status,
      });
      return;
    }

    let providerId: string;
    try {
      const result = await opts.dispatcher.refund(payment);
      providerId = result.refundId || newRefundId();
    } catch {
      res.status(502).json({ ok: false, error: "refund dispatcher failed" });
      return;
    }

    const refund: RefundRecord = {
      refundId: providerId,
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      createdAt: now(),
      idempotencyKey,
    };

    await opts.refunds.save(refund);
    await opts.payments.markRefunded(payment.id);

    res.status(201).json({ ok: true, refund, idempotent: false });
  });

  return router;
}
