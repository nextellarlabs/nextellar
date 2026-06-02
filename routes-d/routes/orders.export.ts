// GET /orders/export — streams filtered orders as CSV (#301).
// Accepts the same filters as the search endpoint but writes
// text/csv rows rather than a JSON array, so large result sets
// never need to be buffered in memory.

import { Router, type Request, type Response } from "express";
import {
  type OrderIndex,
  type OrderSearchQuery,
  type OrderStatus,
  type IndexedOrder,
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

const CSV_HEADER = "id,customer,status,amount,createdAt\n";

function escapeCsv(value: string | number): string {
  const s = String(value);
  // Wrap in quotes if the value contains a comma, quote, or newline
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToCsv(order: IndexedOrder): string {
  return [
    escapeCsv(order.id),
    escapeCsv(order.customer),
    escapeCsv(order.status),
    escapeCsv(order.amount),
    escapeCsv(new Date(order.createdAt).toISOString()),
  ].join(",") + "\n";
}

function parseEpoch(value: unknown): { value?: number; error?: string } {
  if (value === undefined) return { value: undefined };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return { error: `expected an epoch-ms number, got ${JSON.stringify(value)}` };
  }
  return { value: n };
}

export interface OrdersExportRouterOptions {
  index: OrderIndex;
  /** Injected for access-control tests; defaults to allowing all requests. */
  guard?: (req: Request) => boolean;
}

export function createOrdersExportRouter(opts: OrdersExportRouterOptions): Router {
  const router = Router();
  const guard = opts.guard ?? (() => true);

  router.get("/export", async (req: Request, res: Response) => {
    // Access control hook — lets tests inject a denial check
    if (!guard(req)) {
      res.status(403).json({ ok: false, error: "forbidden" });
      return;
    }

    const q = req.query["q"];
    const status = req.query["status"];
    const fromRaw = req.query["from"];
    const toRaw = req.query["to"];
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

    const query: OrderSearchQuery = {
      q: q as string | undefined,
      status: status as OrderStatus | undefined,
      from: from.value,
      to: to.value,
      sortBy:
        typeof sortByRaw === "string"
          ? (sortByRaw as OrderSearchQuery["sortBy"])
          : undefined,
      sortDir:
        typeof sortDirRaw === "string"
          ? (sortDirRaw as OrderSearchQuery["sortDir"])
          : undefined,
    };

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="orders.csv"');
    res.setHeader("Transfer-Encoding", "chunked");

    // Write header row
    const headerOk = res.write(CSV_HEADER);

    // Drain if needed before streaming rows
    if (!headerOk) {
      await new Promise<void>((resolve, reject) => {
        res.once("drain", resolve);
        res.once("error", reject);
        res.once("close", () => reject(new Error("response closed")));
      });
    }

    try {
      for await (const order of opts.index.iterate(query)) {
        if (res.destroyed || res.writableEnded) break;
        const row = rowToCsv(order);
        const ok = res.write(row);
        if (!ok) {
          await new Promise<void>((resolve, reject) => {
            res.once("drain", resolve);
            res.once("error", reject);
            res.once("close", () => reject(new Error("response closed")));
          });
        }
      }
      res.end();
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: "export stream failed" });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });

  return router;
}
