import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type PayoutStatus = "pending" | "processing" | "completed" | "failed";

type PayoutRecord = {
  id: string;
  workspaceId: string;
  contractorId: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  submittedAt: string;
};

// In-memory store
const payouts = new Map<string, PayoutRecord>();

/**
 * GET /lancepay/contractors/:id/payouts
 * Return the payout history for a single LancePay contractor.
 * Supports filtering by date range (from/to) and status.
 * Paginated and sorted by submittedAt descending.
 */
router.get(
  "/lancepay/contractors/:id/payouts",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contractorId = req.params.id?.trim();
      if (!contractorId) {
        sendError(res, "INVALID_CONTRACTOR_ID", "contractorId is required", 400);
        return;
      }

      const { status, from, to, page = "1", limit = "20" } = req.query;

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

      let fromDate: Date | undefined;
      let toDate: Date | undefined;

      if (from && typeof from === "string") {
        fromDate = new Date(from);
        if (isNaN(fromDate.getTime())) {
          sendError(res, "INVALID_FROM_DATE", "from must be a valid ISO date string", 400);
          return;
        }
      }

      if (to && typeof to === "string") {
        toDate = new Date(to);
        if (isNaN(toDate.getTime())) {
          sendError(res, "INVALID_TO_DATE", "to must be a valid ISO date string", 400);
          return;
        }
      }

      let filtered = Array.from(payouts.values()).filter(
        (p) => p.contractorId === contractorId,
      );

      if (status && typeof status === "string") {
        filtered = filtered.filter((p) => p.status === status.trim());
      }

      if (fromDate) {
        filtered = filtered.filter((p) => new Date(p.submittedAt) >= fromDate!);
      }

      if (toDate) {
        filtered = filtered.filter((p) => new Date(p.submittedAt) <= toDate!);
      }

      filtered.sort(
        (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
      );

      const offset = (pageNum - 1) * limitNum;
      const paged = filtered.slice(offset, offset + limitNum);

      return res.status(200).json({
        success: true,
        data: paged,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: filtered.length,
          hasNext: offset + limitNum < filtered.length,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedPayout(p: PayoutRecord): void {
  payouts.set(p.id, { ...p });
}

export function __resetPayouts(): void {
  payouts.clear();
}

export function __getPayouts(): Map<string, PayoutRecord> {
  return payouts;
}

export default router;
