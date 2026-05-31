import { Router, type Request, type Response } from "express";
import { createBackpressureSource, pipeJsonArray } from "../lib/jsonStream.js";
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

export interface OrdersExportRouterOptions {
  index: OrderIndex;
}

function parseEpoch(value: unknown): { value?: number; error?: string } {
  if (value === undefined) return { value: undefined };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return { error: `expected an epoch-ms number, got ${JSON.stringify(value)}` };
  }
  return { value: n };
}

export function createOrdersExportRouter(opts: OrdersExportRouterOptions): Router {
  const router = Router();

  router.get("/export", async (req: Request, res: Response) => {
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

    const source = createBackpressureSource(opts.index.iterate(query));
    try {
      await pipeJsonArray(res, source);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: "export stream failed" });
      }
    }
  });

  return router;
}
