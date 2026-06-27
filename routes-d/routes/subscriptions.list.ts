import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type SubscriptionStatus = "active" | "paused" | "cancelled";

type Subscription = {
  id: string;
  userId: string;
  planId: string;
  billingInterval: "monthly" | "yearly";
  status: SubscriptionStatus;
  startDate: string;
  createdAt: string;
};

const subscriptions = new Map<string, Subscription>();

export function __resetSubscriptions(): void {
  subscriptions.clear();
}

export function __seedSubscription(sub: Subscription): void {
  subscriptions.set(sub.id, { ...sub });
}

export function __getSubscriptions(): Map<string, Subscription> {
  return subscriptions;
}

/**
 * GET /subscriptions
 * List subscriptions belonging to the calling user.
 * Query params: status, planId, page, limit
 * Sorted by startDate ascending (oldest first).
 */
router.get(
  "/subscriptions",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers["x-user-id"] as string | undefined;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
        return;
      }

      const { status, planId, page = "1", limit = "20" } = req.query;

      const pageNum = parseInt(String(page), 10);
      const limitNum = parseInt(String(limit), 10);

      if (isNaN(pageNum) || pageNum < 1) {
        sendError(res, "INVALID_PAGE", "page must be a positive integer", 400);
        return;
      }

      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        sendError(res, "INVALID_LIMIT", "limit must be between 1 and 100", 400);
        return;
      }

      let filtered = Array.from(subscriptions.values()).filter(
        (sub) => sub.userId === userId,
      );

      if (status && typeof status === "string") {
        filtered = filtered.filter((sub) => sub.status === status.trim());
      }

      if (planId && typeof planId === "string") {
        filtered = filtered.filter((sub) => sub.planId === planId.trim());
      }

      // Sort by startDate ascending (oldest subscription first)
      filtered.sort(
        (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
      );

      const total = filtered.length;
      const offset = (pageNum - 1) * limitNum;
      const paged = filtered.slice(offset, offset + limitNum);

      return res.status(200).json({
        success: true,
        data: paged,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          hasNext: offset + limitNum < total,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
