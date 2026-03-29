import { Router, Request, Response, NextFunction } from "express";

const router = Router();

type DashboardData = {
  userStats: unknown;
  recentOrders: unknown;
  revenueTotals: unknown;
  activeSessions: unknown;
  alerts: unknown;
};

type DashboardResponse = {
  success: true;
  data: DashboardData;
  degraded: boolean;
};

/**
 * GET /dashboard
 * Fetches five independent data sources concurrently via Promise.allSettled.
 * Individual failures are returned as null with a degraded flag, rather
 * than failing the entire request.
 */
router.get(
  "/dashboard",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [
        userStatsResult,
        recentOrdersResult,
        revenueTotalsResult,
        activeSessionsResult,
        alertsResult,
      ] = await Promise.allSettled([
        fetchUserStats(),
        fetchRecentOrders(),
        fetchRevenueTotals(),
        fetchActiveSessions(),
        fetchAlerts(),
      ]);

      const data: DashboardData = {
        userStats:
          userStatsResult.status === "fulfilled"
            ? userStatsResult.value
            : null,
        recentOrders:
          recentOrdersResult.status === "fulfilled"
            ? recentOrdersResult.value
            : null,
        revenueTotals:
          revenueTotalsResult.status === "fulfilled"
            ? revenueTotalsResult.value
            : null,
        activeSessions:
          activeSessionsResult.status === "fulfilled"
            ? activeSessionsResult.value
            : null,
        alerts:
          alertsResult.status === "fulfilled" ? alertsResult.value : null,
      };

      const degraded = [
        userStatsResult,
        recentOrdersResult,
        revenueTotalsResult,
        activeSessionsResult,
        alertsResult,
      ].some((r) => r.status === "rejected");

      const body: DashboardResponse = { success: true, data, degraded };
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  },
);

export default router;

// ---------------------------------------------------------------------------
// Stubs - swap out for your actual service / DB layer
// ---------------------------------------------------------------------------
export async function fetchUserStats(): Promise<{ totalUsers: number }> {
  return { totalUsers: 42 };
}

export async function fetchRecentOrders(): Promise<{ count: number }> {
  return { count: 7 };
}

export async function fetchRevenueTotals(): Promise<{ total: number }> {
  return { total: 15000 };
}

export async function fetchActiveSessions(): Promise<{ active: number }> {
  return { active: 12 };
}

export async function fetchAlerts(): Promise<{ unread: number }> {
  return { unread: 3 };
}
