import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type PayoutStatus = "pending" | "processing" | "completed" | "failed";

type Payout = {
  id: string;
  workspaceId: string;
  status: PayoutStatus;
  approvers: Set<string>;
  requiredApprovals: number;
};

type ApproveBody = {
  adminId: string;
};

// In-memory store
const payouts = new Map<string, Payout>();

/**
 * POST /lancepay/payouts/:id/approve
 * Approve a queued LancePay payout under a multi-approver policy.
 */
router.post(
  "/lancepay/payouts/:id/approve",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payoutId = req.params.id?.trim();
      if (!payoutId) {
        sendError(res, "INVALID_PAYOUT_ID", "payoutId is required", 400);
        return;
      }

      const body = req.body as ApproveBody;
      const adminId = body.adminId || req.headers["x-admin-id"] as string | undefined;

      if (!adminId || typeof adminId !== "string" || !adminId.trim()) {
        sendError(
          res,
          "UNAUTHORIZED",
          "workspace-admin identity required",
          403,
        );
        return;
      }

      const payout = payouts.get(payoutId);

      if (!payout) {
        sendError(res, "NOT_FOUND", "Payout not found", 404);
        return;
      }

      if (payout.status !== "pending") {
        sendError(
          res,
          "INVALID_STATUS",
          "Payout is not pending approval",
          400,
        );
        return;
      }

      const approverId = adminId.trim();

      if (payout.approvers.has(approverId)) {
        return res.status(200).json({
          success: true,
          data: {
            payoutId,
            status: payout.status,
            approvals: payout.approvers.size,
            requiredApprovals: payout.requiredApprovals,
          },
          message: "Already approved by this admin",
        });
      }

      payout.approvers.add(approverId);

      // Trigger submission when the threshold is reached
      let message = "Approval recorded";
      if (payout.approvers.size >= payout.requiredApprovals) {
        payout.status = "processing";
        message = "Approval threshold reached, payout is now processing";
      }

      return res.status(200).json({
        success: true,
        data: {
          payoutId,
          status: payout.status,
          approvals: payout.approvers.size,
          requiredApprovals: payout.requiredApprovals,
        },
        message,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedPayout(p: Omit<Payout, "approvers"> & { approvers: string[] }): void {
  payouts.set(p.id, { ...p, approvers: new Set(p.approvers) });
}

export function __getPayout(id: string): Payout | undefined {
  return payouts.get(id);
}

export function __resetPayouts(): void {
  payouts.clear();
}

export default router;
