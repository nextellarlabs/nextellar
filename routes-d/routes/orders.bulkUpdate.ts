// POST /orders/bulk-status — bulk order status update for admins (#303).
//
// The admin tooling needs to flip many orders at once (e.g. mark a
// shipment batch as `shipped`). Doing this one HTTP call at a time is
// slow and noisy in audit logs. This route takes an array of
// `{ orderId, status }` items and returns a per-item result so a
// partial failure does not abort the whole batch.
//
// Every transition is validated through the shared
// `orderStateMachine.ts` so the rules stay in one place. Items that
// fail validation, are missing, or are already in the target status
// surface as `{ ok: false, error }` entries — the response is always
// 200 with the per-item array; the HTTP layer only 4xx's on malformed
// envelopes (not malformed items).

import { Router, type Request, type Response } from "express";
import {
  IllegalTransitionError,
  assertTransition,
  isOrderStatus,
  type OrderStatus,
} from "../lib/orderStateMachine.js";

export interface BulkOrderRecord {
  id: string;
  status: OrderStatus;
  updatedAt: number;
}

export interface BulkOrderStore {
  get(id: string): Promise<BulkOrderRecord | undefined>;
  save(order: BulkOrderRecord): Promise<void>;
}

export interface BulkUpdateItemResult {
  orderId: string;
  ok: boolean;
  status?: OrderStatus;
  /** Present when `ok === false`. */
  error?: string;
  /** Present for illegal transitions so the client can render context. */
  from?: OrderStatus;
  to?: OrderStatus;
}

export interface BulkUpdateRouterOptions {
  store: BulkOrderStore;
  now?: () => number;
  /** Hard cap on items per call. Defaults to 100 — large enough for
   *  realistic batches, small enough to keep responses bounded. */
  maxItems?: number;
}

interface InboundItem {
  orderId: string;
  status: OrderStatus;
}

interface BulkRequestBody {
  items?: unknown;
}

/**
 * Parse the request envelope into a typed list of items. Returns
 * `{ error }` on any structural issue so the caller can 400; per-item
 * status / id problems are deferred to the executor so they show up in
 * the per-item result.
 */
function parseEnvelope(
  body: unknown,
  maxItems: number,
): { items: InboundItem[] } | { error: string } {
  if (!body || typeof body !== "object") return { error: "request body is required" };
  const items = (body as BulkRequestBody).items;
  if (!Array.isArray(items)) return { error: "items must be an array" };
  if (items.length === 0) return { error: "items must not be empty" };
  if (items.length > maxItems) {
    return { error: `items exceeds maximum of ${maxItems}` };
  }

  const out: InboundItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    if (!raw || typeof raw !== "object") {
      return { error: `items[${i}] must be an object` };
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.orderId !== "string" || r.orderId.trim() === "") {
      return { error: `items[${i}].orderId must be a non-empty string` };
    }
    if (!isOrderStatus(r.status)) {
      return { error: `items[${i}].status must be a valid OrderStatus` };
    }
    out.push({ orderId: r.orderId, status: r.status });
  }
  return { items: out };
}

/**
 * Apply a single item against the store. Returns a per-item result;
 * never throws. Extracted so tests can exercise per-item branches
 * without HTTP overhead.
 */
export async function applyBulkItem(
  item: InboundItem,
  store: BulkOrderStore,
  now: () => number,
): Promise<BulkUpdateItemResult> {
  const existing = await store.get(item.orderId);
  if (!existing) {
    return { orderId: item.orderId, ok: false, error: `order ${item.orderId} not found` };
  }
  try {
    assertTransition(existing.status, item.status);
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return {
        orderId: item.orderId,
        ok: false,
        error: err.message,
        from: err.from,
        to: err.to,
      };
    }
    throw err;
  }

  const updated: BulkOrderRecord = {
    ...existing,
    status: item.status,
    updatedAt: now(),
  };
  await store.save(updated);
  return { orderId: item.orderId, ok: true, status: item.status };
}

export function createOrdersBulkUpdateRouter(opts: BulkUpdateRouterOptions): Router {
  const router = Router();
  const now = opts.now ?? Date.now;
  const maxItems = opts.maxItems ?? 100;

  router.post("/bulk-status", async (req: Request, res: Response) => {
    const parsed = parseEnvelope(req.body, maxItems);
    if ("error" in parsed) {
      res.status(400).json({ ok: false, error: parsed.error });
      return;
    }

    // Sequential application keeps per-id ordering deterministic and
    // avoids racing two updates against the same id within one batch.
    const results: BulkUpdateItemResult[] = [];
    for (const item of parsed.items) {
      results.push(await applyBulkItem(item, opts.store, now));
    }

    const succeeded = results.filter((r) => r.ok).length;
    res.status(200).json({
      ok: true,
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    });
  });

  return router;
}
