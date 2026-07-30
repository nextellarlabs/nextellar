import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type PayoutStatus = "pending" | "processing" | "completed" | "failed";

type RetryEntry = {
  attemptedAt: string;
  reason: string;
};

type Payout = {
  id: string;
  workspaceId: string;
  contractorId: string;
  destinationWallet: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  fees?: number;
  stellarTxHash?: string;
  retryHistory?: RetryEntry[];
  createdAt: string;
  settledAt?: string;
};

// In-memory store
const payouts = new Map<string, Payout>();

/**
 * GET /lancepay/payouts/:id
 * Return a single payout with status, fees, and Stellar tx hash.
 * Restricted to workspace members and the destination contractor.
 * Includes retry history when present.
 */
router.get(
  "/lancepay/payouts/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const callerId = req.headers["x-caller-id"] as string | undefined;
      if (!callerId) {
        sendError(res, "MISSING_CALLER", "x-caller-id header is required", 401);
        return;
      }

      const payoutId = req.params.id?.trim();
      if (!payoutId) {
        sendError(res, "INVALID_PAYOUT_ID", "payoutId is required", 400);
        return;
      }

      const payout = payouts.get(payoutId);
      if (!payout) {
        sendError(res, "NOT_FOUND", "Payout not found", 404);
        return;
      }

      // Caller must be a workspace member or the destination contractor
      if (callerId !== payout.workspaceId && callerId !== payout.contractorId) {
        sendError(
          res,
          "FORBIDDEN",
          "Access denied: caller is not a workspace member or the destination contractor",
          403,
        );
        return;
      }

      const response: Record<string, unknown> = {
        id: payout.id,
        workspaceId: payout.workspaceId,
        contractorId: payout.contractorId,
        destinationWallet: payout.destinationWallet,
        amount: payout.amount,
        currency: payout.currency,
        status: payout.status,
        createdAt: payout.createdAt,
      };

      if (payout.fees !== undefined) response.fees = payout.fees;
      if (payout.stellarTxHash) response.stellarTxHash = payout.stellarTxHash;
      if (payout.settledAt) response.settledAt = payout.settledAt;
      if (payout.retryHistory && payout.retryHistory.length > 0) {
        response.retryHistory = payout.retryHistory;
      }

      return res.status(200).json({ success: true, data: response });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedPayout(p: Payout): void {
  payouts.set(p.id, { ...p });
}

export function __resetPayouts(): void {
  payouts.clear();
}

export function __getPayouts(): Map<string, Payout> {
  return payouts;
}

export default router;
