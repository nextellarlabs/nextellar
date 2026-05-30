// PATCH /orders/:id/status — sample order update route that gates every
// status change through `orderStateMachine.ts` (#297). The store is
// pluggable so tests can inject an in-memory map without touching real
// persistence.

import { Router, type Request, type Response } from "express";
import {
  IllegalTransitionError,
  assertTransition,
  isOrderStatus,
  type OrderStatus,
} from "../lib/orderStateMachine.js";

export interface OrderRecord {
  id: string;
  status: OrderStatus;
  updatedAt: number;
}

export interface OrderStore {
  get(id: string): Promise<OrderRecord | undefined>;
  save(order: OrderRecord): Promise<void>;
}

export interface OrderUpdateRouterOptions {
  store: OrderStore;
  /** Stamp for `updatedAt`. Defaults to `Date.now`; tests fix it. */
  now?: () => number;
  /** Optional emit hook (e.g. webhook publisher) called once after the
   *  status is persisted. */
  onTransition?: (order: OrderRecord, previous: OrderStatus) => void | Promise<void>;
}

interface UpdateBody {
  status?: unknown;
}

export function createOrdersUpdateRouter(opts: OrderUpdateRouterOptions): Router {
  const router = Router();
  const now = opts.now ?? Date.now;

  router.patch("/:id/status", async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as UpdateBody;

    if (!isOrderStatus(body.status)) {
      res.status(400).json({ ok: false, error: "status is required and must be a valid OrderStatus" });
      return;
    }

    const existing = await opts.store.get(id);
    if (!existing) {
      res.status(404).json({ ok: false, error: `order ${id} not found` });
      return;
    }

    try {
      assertTransition(existing.status, body.status);
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
    const updated: OrderRecord = {
      ...existing,
      status: body.status,
      updatedAt: now(),
    };
    await opts.store.save(updated);

    if (opts.onTransition) {
      await opts.onTransition(updated, previous);
    }

    res.status(200).json({ ok: true, order: updated });
  });

  return router;
}
