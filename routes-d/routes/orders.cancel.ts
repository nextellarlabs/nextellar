// POST /orders/:id/cancel — cancellation endpoint for routes-d (#298).
//
// The route enforces the order lifecycle from `orderStateMachine.ts`,
// persists the cancelled order, and optionally invokes downstream hooks
// for webhook emission and refund processing.

import { Router, type Request, type Response } from "express";
import { returnStock } from "../lib/inventory.js";
import {
  IllegalTransitionError,
  assertTransition,
  type OrderStatus,
} from "../lib/orderStateMachine.js";

export interface CancelableOrderRecord {
  id: string;
  status: OrderStatus;
  updatedAt: number;
  paymentCaptured?: boolean;
  productId?: string;
  quantity?: number;
}

export interface CancelOrderStore {
  get(id: string): Promise<CancelableOrderRecord | undefined>;
  save(order: CancelableOrderRecord): Promise<void>;
}

export interface OrdersCancelRouterOptions {
  store: CancelOrderStore;
  now?: () => number;
  onCancel?: (order: CancelableOrderRecord, previous: OrderStatus) => void | Promise<void>;
  onRefund?: (order: CancelableOrderRecord, previous: OrderStatus) => void | Promise<void>;
}

export function createOrdersCancelRouter(opts: OrdersCancelRouterOptions): Router {
  const router = Router();
  const now = opts.now ?? Date.now;

  router.post("/:id/cancel", async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const existing = await opts.store.get(id);

    if (!existing) {
      res.status(404).json({ ok: false, error: `order ${id} not found` });
      return;
    }

    try {
      assertTransition(existing.status, "cancelled");
    } catch (err) {
      if (err instanceof IllegalTransitionError) {
        res.status(409).json({
          ok: false,
          error: err.message,
          from: err.from,
          to: err.to,
        });
        return;
      }
      throw err;
    }

    const previous = existing.status;
    const updated: CancelableOrderRecord = {
      ...existing,
      status: "cancelled",
      updatedAt: now(),
    };

    await opts.store.save(updated);

    if (existing.productId && existing.quantity) {
      returnStock(existing.productId, existing.quantity);
    }

    if (opts.onCancel) {
      await opts.onCancel(updated, previous);
    }

    if (existing.paymentCaptured && opts.onRefund) {
      await opts.onRefund(updated, previous);
    }

    res.status(200).json({
      ok: true,
      order: updated,
      refunded: Boolean(existing.paymentCaptured),
    });
  });

  return router;
}
