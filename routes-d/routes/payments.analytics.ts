import { Router, type Request, type Response, type RequestHandler } from "express";
import { requireRole } from "../middleware/rbac.js";
import { Roles } from "../auth/roles.js";
import {
  AnalyticsCache,
  getPaymentAnalytics,
  type AnalyticsWindow,
  type PaymentAnalyticsStore,
} from "../lib/paymentAnalytics.js";

export interface PaymentsAnalyticsRouterOptions {
  store: PaymentAnalyticsStore;
  cache?: AnalyticsCache;
  cacheTtlMs?: number;
  adminGuard?: RequestHandler;
  now?: () => number;
}

const DEFAULT_WINDOW_MS = 7 * 86_400_000;

function parseWindow(value: unknown): AnalyticsWindow | null {
  if (value === "daily" || value === "weekly") return value;
  return null;
}

export function createPaymentsAnalyticsRouter(options: PaymentsAnalyticsRouterOptions): Router {
  const router = Router();
  const cache = options.cache ?? new AnalyticsCache(options.cacheTtlMs ?? 30_000);
  const now = options.now ?? Date.now;
  const adminGuard = options.adminGuard ?? requireRole(Roles.Admin);

  router.get(
    "/analytics",
    adminGuard,
    async (req: Request, res: Response) => {
      const window = parseWindow(req.query.window);
      if (!window) {
        res.status(400).json({ error: "window must be daily or weekly" });
        return;
      }

      const toMs =
        typeof req.query.to === "string" && req.query.to.trim() !== ""
          ? Date.parse(req.query.to)
          : now();
      const fromMs =
        typeof req.query.from === "string" && req.query.from.trim() !== ""
          ? Date.parse(req.query.from)
          : toMs - DEFAULT_WINDOW_MS;

      if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs >= toMs) {
        res.status(400).json({ error: "invalid from/to range" });
        return;
      }

      const { result, cacheHit } = await getPaymentAnalytics(
        options.store,
        cache,
        window,
        fromMs,
        toMs,
        now(),
      );

      res.status(200).json({
        ok: true,
        cacheHit,
        analytics: result,
      });
    },
  );

  return router;
}
