import { Router, type Request, type Response } from "express";
import {
  confirmReservation,
  InsufficientStockError,
  releaseReservation,
  reserveStock,
} from "../lib/inventory.js";
import type { OrderStatus } from "../lib/orderIndex.js";

export interface CreateOrderRecord {
  id: string;
  customer: string;
  productId: string;
  quantity: number;
  status: OrderStatus;
  reservationId?: string;
  amount: number;
  createdAt: number;
}

export interface CreateOrderStore {
  get(id: string): Promise<CreateOrderRecord | undefined>;
  save(order: CreateOrderRecord): Promise<void>;
}

export interface OrdersCreateRouterOptions {
  store: CreateOrderStore;
  now?: () => number;
  nextId?: () => string;
}

function parsePositiveInt(value: unknown): { value?: number; error?: string } {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return { error: `expected a positive integer, got ${JSON.stringify(value)}` };
  }
  return { value: n };
}

export function createOrdersCreateRouter(opts: OrdersCreateRouterOptions): Router {
  const router = Router();
  const now = opts.now ?? (() => Date.now());
  const nextId = opts.nextId ?? (() => `${now()}-${Math.random().toString(36).slice(2, 8)}`);

  router.post("/", async (req: Request, res: Response) => {
    const customer = typeof req.body?.customer === "string" ? req.body.customer.trim() : "";
    const productId = typeof req.body?.productId === "string" ? req.body.productId.trim() : "";
    const quantity = parsePositiveInt(req.body?.quantity ?? 1);
    const amount = Number(req.body?.amount ?? 0);

    if (!customer) {
      res.status(400).json({ ok: false, error: "customer is required" });
      return;
    }
    if (!productId) {
      res.status(400).json({ ok: false, error: "productId is required" });
      return;
    }
    if (quantity.error) {
      res.status(400).json({ ok: false, error: `quantity: ${quantity.error}` });
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      res.status(400).json({ ok: false, error: "amount must be a non-negative number" });
      return;
    }

    let reservationId: string | undefined;
    try {
      const reservation = reserveStock(productId, quantity.value!);
      reservationId = reservation.reservationId;

      const order: CreateOrderRecord = {
        id: nextId(),
        customer,
        productId,
        quantity: quantity.value!,
        status: "pending",
        reservationId,
        amount,
        createdAt: now(),
      };

      await opts.store.save(order);
      confirmReservation(reservationId);

      res.status(201).json({ ok: true, order });
    } catch (err) {
      if (reservationId) {
        releaseReservation(reservationId);
      }
      if (err instanceof InsufficientStockError) {
        res.status(409).json({
          ok: false,
          error: "insufficient stock",
          productId: err.productId,
          available: err.available,
        });
        return;
      }
      throw err;
    }
  });

  return router;
}
