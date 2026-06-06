import { Router, type Request, type Response } from "express";
import { decodeCursor } from "../lib/pagination.js";
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  listOrdersWithCursor,
  type OrderListQuery,
} from "../lib/orderList.js";
import { type IndexedOrder, type OrderIndex, type OrderStatus } from "../lib/orderIndex.js";

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

export interface OrdersListRouterOptions {
  index: OrderIndex;
  cursorSecret?: string;
}

function parseLimit(value: unknown): { value?: number; error?: string } {
  if (value === undefined) return { value: DEFAULT_LIST_LIMIT };
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return { error: `expected a positive integer, got ${JSON.stringify(value)}` };
  }
  return { value: Math.min(n, MAX_LIST_LIMIT) };
}

function parseEpoch(value: unknown): { value?: number; error?: string } {
  if (value === undefined) return { value: undefined };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return { error: `expected an epoch-ms number, got ${JSON.stringify(value)}` };
  }
  return { value: n };
}

export function createOrdersListRouter(opts: OrdersListRouterOptions): Router {
  const router = Router();

  router.get("/list", async (req: Request, res: Response) => {
    const status = req.query["status"];
    const customer = req.query["customer"];
    const fromRaw = req.query["from"];
    const toRaw = req.query["to"];
    const limitRaw = req.query["limit"];
    const cursorRaw = req.query["cursor"];
    const sortByRaw = req.query["sortBy"];
    const sortDirRaw = req.query["sortDir"];

    if (status !== undefined) {
      if (typeof status !== "string" || !ALLOWED_STATUSES.includes(status as OrderStatus)) {
        res.status(400).json({
          ok: false,
          error: `status must be one of: ${ALLOWED_STATUSES.join(", ")}`,
        });
        return;
      }
    }

    if (customer !== undefined && typeof customer !== "string") {
      res.status(400).json({ ok: false, error: "customer must be a string" });
      return;
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

    const limit = parseLimit(limitRaw);
    if (limit.error) {
      res.status(400).json({ ok: false, error: `limit: ${limit.error}` });
      return;
    }

    let sortBy: OrderListQuery["sortBy"];
    if (sortByRaw !== undefined) {
      if (typeof sortByRaw !== "string" || !(ALLOWED_SORT_BY as readonly string[]).includes(sortByRaw)) {
        res.status(400).json({ ok: false, error: `sortBy must be one of: ${ALLOWED_SORT_BY.join(", ")}` });
        return;
      }
      sortBy = sortByRaw as OrderListQuery["sortBy"];
    }

    let sortDir: OrderListQuery["sortDir"];
    if (sortDirRaw !== undefined) {
      if (typeof sortDirRaw !== "string" || !(ALLOWED_SORT_DIR as readonly string[]).includes(sortDirRaw)) {
        res.status(400).json({ ok: false, error: `sortDir must be one of: ${ALLOWED_SORT_DIR.join(", ")}` });
        return;
      }
      sortDir = sortDirRaw as OrderListQuery["sortDir"];
    }

    const cursor = typeof cursorRaw === "string" ? cursorRaw.trim() : undefined;
    if (cursorRaw !== undefined && !cursor) {
      res.status(400).json({ ok: false, error: "cursor must be a non-empty string" });
      return;
    }

    const query: OrderListQuery = {
      status: status as OrderStatus | undefined,
      customer: customer as string | undefined,
      from: from.value,
      to: to.value,
      limit: limit.value,
      sortBy,
      sortDir,
      cursor,
      cursorSecret: opts.cursorSecret,
    };

    if (cursor) {
      try {
        decodeCursor(cursor, { secret: opts.cursorSecret });
      } catch (err) {
        res.status(400).json({
          ok: false,
          error: err instanceof Error ? err.message : "invalid cursor",
        });
        return;
      }
    }

    const all: IndexedOrder[] = [];
    for await (const order of opts.index.iterate({})) {
      all.push(order);
    }
    const page = listOrdersWithCursor(all, query);
    res.status(200).json({ ok: true, results: page.results, pagination: page.pagination });
  });

  return router;
}
