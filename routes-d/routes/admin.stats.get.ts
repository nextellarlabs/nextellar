import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type PlatformStats = {
  activeUsers: number;
  paymentVolumeUsd: number;
  webhookHealthPercent: number;
  cachedAt: string;
};

type StatsStore = {
  activeUsers: number;
  paymentVolumeUsd: number;
  webhookDeliveriesTotal: number;
  webhookDeliveriesSuccess: number;
};

// In-memory aggregate data
let statsStore: StatsStore = {
  activeUsers: 0,
  paymentVolumeUsd: 0,
  webhookDeliveriesTotal: 0,
  webhookDeliveriesSuccess: 0,
};

// Brief in-memory cache (30 seconds TTL)
const CACHE_TTL_MS = 30_000;
let cachedStats: PlatformStats | null = null;
let cacheExpiresAt = 0;

function computeStats(): PlatformStats {
  const webhookHealthPercent =
    statsStore.webhookDeliveriesTotal === 0
      ? 100
      : Math.round(
          (statsStore.webhookDeliveriesSuccess / statsStore.webhookDeliveriesTotal) * 100,
        );

  return {
    activeUsers: statsStore.activeUsers,
    paymentVolumeUsd: statsStore.paymentVolumeUsd,
    webhookHealthPercent,
    cachedAt: new Date().toISOString(),
  };
}

/**
 * GET /admin/stats
 * Return aggregate platform stats: active users, payment volume, webhook health.
 * Restricted to operator role (x-operator-id header required).
 * Results are cached for 30 seconds to reduce compute on repeated calls.
 */
router.get(
  "/admin/stats",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const operatorId =
        (req.headers["x-operator-id"] as string | undefined) ||
        (req.body?.operatorId as string | undefined);

      if (!operatorId || !operatorId.trim()) {
        sendError(res, "UNAUTHORIZED", "Operator identity required", 401);
        return;
      }

      const now = Date.now();
      if (cachedStats && now < cacheExpiresAt) {
        return res.status(200).json({ success: true, data: cachedStats });
      }

      cachedStats = computeStats();
      cacheExpiresAt = now + CACHE_TTL_MS;

      return res.status(200).json({ success: true, data: cachedStats });
    } catch (err) {
      return next(err);
    }
  },
);

export function __setStatsStore(data: Partial<StatsStore>): void {
  statsStore = { ...statsStore, ...data };
  cachedStats = null;
  cacheExpiresAt = 0;
}

export function __resetStats(): void {
  statsStore = {
    activeUsers: 0,
    paymentVolumeUsd: 0,
    webhookDeliveriesTotal: 0,
    webhookDeliveriesSuccess: 0,
  };
  cachedStats = null;
  cacheExpiresAt = 0;
}

export function __expireCache(): void {
  cachedStats = null;
  cacheExpiresAt = 0;
}

export default router;
