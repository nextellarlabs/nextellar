// GET /orders/search — paginated multi-filter search over the order
// index (#300). Validates every query parameter at the boundary and
// rejects ill-formed input with 400 + a precise reason.

import { Router, type Request, type Response } from "express";
import {
  type OrderIndex,
  type OrderSearchQuery,
  type OrderStatus,
} from "../lib/orderIndex.js";

const ALLOWED_STATUSES: ReadonlyArray<OrderStatus> = [
  "pending",
  "paid",
  "fulfilled",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
];

const ALLOWED_SORT_BY = ["createdAt", "amount", "customer"] as const;
const ALLOWED_SORT_DIR = ["asc", "desc"] as const;

export interface OrdersSearchRouterOptions {
  index: OrderIndex;
}

function parsePositiveInt(value: unknown, fallback: number): { value?: number; error?: string } {
  if (value === undefined) return { value: fallback };
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return { error: `expected a positive integer, got ${JSON.stringify(value)}` };
  }
  return { value: n };
}

function parseEpoch(value: unknown): { value?: number; error?: string } {
  if (value === undefined) return { value: undefined };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return { error: `expected an epoch-ms number, got ${JSON.stringify(value)}` };
  }
  return { value: n };
}

export function createOrdersSearchRouter(opts: OrdersSearchRouterOptions): Router {
  const router = Router();

  router.get("/search", (req: Request, res: Response) => {
    const q = req.query["q"];
    const status = req.query["status"];
    const fromRaw = req.query["from"];
    const toRaw = req.query["to"];
    const pageRaw = req.query["page"];
    const pageSizeRaw = req.query["pageSize"];
    const sortByRaw = req.query["sortBy"];
    const sortDirRaw = req.query["sortDir"];

    if (q !== undefined && typeof q !== "string") {
      res.status(400).json({ ok: false, error: "q must be a string" });
      return;
    }
    if (status !== undefined) {
      if (typeof status !== "string" || !ALLOWED_STATUSES.includes(status as OrderStatus)) {
        res.status(400).json({
          ok: false,
          error: `status must be one of: ${ALLOWED_STATUSES.join(", ")}`,
        });
        return;
      }
    }
    const from = parseEpoch(fromRaw);
    if (from.error) {
      res.status(400).json({ ok: false, error: `from: ${from.error}` });
      return;
    }
    const to = parseEpoch(toRaw);
    if (to.error) {
      res.status(400).json({ ok: false, error: `to: ${to.error}` });
      return;
    }
    if (from.value !== undefined && to.value !== undefined && from.value > to.value) {
      res.status(400).json({ ok: false, error: "from must be <= to" });
      return;
    }
    const page = parsePositiveInt(pageRaw, 1);
    if (page.error) {
      res.status(400).json({ ok: false, error: `page: ${page.error}` });
      return;
    }
    const pageSize = parsePositiveInt(pageSizeRaw, 20);
    if (pageSize.error) {
      res.status(400).json({ ok: false, error: `pageSize: ${pageSize.error}` });
      return;
    }
    let sortBy: OrderSearchQuery["sortBy"];
    if (sortByRaw !== undefined) {
      if (typeof sortByRaw !== "string" || !(ALLOWED_SORT_BY as readonly string[]).includes(sortByRaw)) {
        res.status(400).json({ ok: false, error: `sortBy must be one of: ${ALLOWED_SORT_BY.join(", ")}` });
        return;
      }
      sortBy = sortByRaw as OrderSearchQuery["sortBy"];
    }
    let sortDir: OrderSearchQuery["sortDir"];
    if (sortDirRaw !== undefined) {
      if (typeof sortDirRaw !== "string" || !(ALLOWED_SORT_DIR as readonly string[]).includes(sortDirRaw)) {
        res.status(400).json({ ok: false, error: `sortDir must be one of: ${ALLOWED_SORT_DIR.join(", ")}` });
        return;
      }
      sortDir = sortDirRaw as OrderSearchQuery["sortDir"];
    }

    const query: OrderSearchQuery = {
      q: q as string | undefined,
      status: status as OrderStatus | undefined,
      from: from.value,
      to: to.value,
      page: page.value,
      pageSize: pageSize.value,
      sortBy,
      sortDir,
    };

    const result = opts.index.search(query);
    res.status(200).json({ ok: true, ...result });
  });

  return router;
}
