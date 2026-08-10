import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type PayoutStatus = "pending" | "processing" | "completed" | "failed";

type Payout = {
  id: string;
  workspaceId: string;
  contractorId: string;
  destinationWallet: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  idempotencyKey?: string;
  createdAt: string;
};

// We need an in-memory store for payouts, but since routes are isolated in this example,
// we will just define it locally and export a helper to seed it for tests.
const payouts = new Map<string, Payout>();

/**
 * GET /lancepay/payouts
 * List payouts for the calling LancePay workspace.
 * Filter by contractor, currency, status, and date range.
 * Paginate sorted by submission time (createdAt).
 */
router.get(
  "/lancepay/payouts",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // In a real app we'd get workspaceId from auth, but here we expect it in query for simplicity,
      // or we can just filter by what's given. Let's assume the workspace ID is "ws-1" or passed via headers/query.
      // We will just filter all payouts we have based on the queries.
      const {
        workspaceId,
        contractorId,
        currency,
        status,
        startDate,
        endDate,
        limit = "50",
        cursor, // representing the last seen createdAt for pagination
      } = req.query;

      if (!workspaceId || typeof workspaceId !== "string") {
        sendError(res, "UNAUTHORIZED", "workspaceId query is required", 401);
        return;
      }

      let results = Array.from(payouts.values()).filter(p => p.workspaceId === workspaceId);

      if (contractorId && typeof contractorId === "string") {
        results = results.filter((p) => p.contractorId === contractorId);
      }

      if (currency && typeof currency === "string") {
        const cur = currency.toUpperCase();
        results = results.filter((p) => p.currency === cur);
      }

      if (status && typeof status === "string") {
        results = results.filter((p) => p.status === status);
      }

      if (startDate && typeof startDate === "string") {
        const start = new Date(startDate).getTime();
        if (!isNaN(start)) {
          results = results.filter((p) => new Date(p.createdAt).getTime() >= start);
        }
      }

      if (endDate && typeof endDate === "string") {
        const end = new Date(endDate).getTime();
        if (!isNaN(end)) {
          results = results.filter((p) => new Date(p.createdAt).getTime() <= end);
        }
      }

      // Sort by submission time descending
      results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Pagination
      if (cursor && typeof cursor === "string") {
        const cursorIndex = results.findIndex(p => p.createdAt === cursor);
        if (cursorIndex !== -1) {
          results = results.slice(cursorIndex + 1);
        }
      }

      const parsedLimit = parseInt(limit as string, 10);
      const limitNum = isNaN(parsedLimit) || parsedLimit <= 0 ? 50 : parsedLimit;

      const hasMore = results.length > limitNum;
      if (hasMore) {
        results = results.slice(0, limitNum);
      }
      
      const nextCursor = results.length > 0 ? results[results.length - 1].createdAt : null;

      return res.status(200).json({
        success: true,
        data: results,
        pagination: {
          nextCursor,
          hasMore,
        }
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedPayout(payout: Payout): void {
  payouts.set(payout.id, payout);
}

export function __resetPayouts(): void {
  payouts.clear();
}

export default router;
