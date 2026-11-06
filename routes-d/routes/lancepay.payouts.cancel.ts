import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type PayoutStatus = "pending" | "queued" | "submitted" | "processing" | "completed" | "failed" | "cancelled";

type Payout = {
  id: string;
  workspaceId: string;
  status: PayoutStatus;
  cancelledAt?: string;
  cancelledBy?: string;
};

type WebhookEvent = {
  event: string;
  payoutId: string;
  workspaceId: string;
  cancelledBy: string;
  cancelledAt: string;
};

// In-memory store
const payouts = new Map<string, Payout>();
const webhookLog: WebhookEvent[] = [];

/** Statuses that can no longer be cancelled because they've been submitted to Stellar */
const SUBMITTED_STATUSES = new Set<PayoutStatus>(["submitted", "processing", "completed", "failed"]);

function emitCancellationWebhook(event: WebhookEvent): void {
  // In production this would POST to registered webhook URLs.
  // Here we log it so tests can verify it fired.
  webhookLog.push(event);
}

/**
 * POST /lancepay/payouts/:id/cancel
 * Cancel a pending or queued LancePay payout before it is submitted to Stellar.
 * Returns 409 if the payout has already been submitted.
 * Returns 403 if the caller does not own the payout.
 */
router.post(
  "/lancepay/payouts/:id/cancel",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payoutId = req.params.id?.trim();
      if (!payoutId) {
        sendError(res, "INVALID_PAYOUT_ID", "payoutId is required", 400);
        return;
      }

      const callerId =
        (req.headers["x-workspace-id"] as string | undefined) ||
        (req.body?.workspaceId as string | undefined);

      if (!callerId || typeof callerId !== "string" || !callerId.trim()) {
        sendError(res, "UNAUTHORIZED", "x-workspace-id header is required", 401);
        return;
      }

      const payout = payouts.get(payoutId);
      if (!payout) {
        sendError(res, "NOT_FOUND", "Payout not found", 404);
        return;
      }

      if (payout.workspaceId !== callerId.trim()) {
        sendError(res, "FORBIDDEN", "You do not have permission to cancel this payout", 403);
        return;
      }

      if (SUBMITTED_STATUSES.has(payout.status)) {
        sendError(
          res,
          "ALREADY_SUBMITTED",
          "Payout has already been submitted to Stellar and cannot be cancelled",
          409,
        );
        return;
      }

      if (payout.status === "cancelled") {
        sendError(res, "ALREADY_CANCELLED", "Payout is already cancelled", 409);
        return;
      }

      const cancelledAt = new Date().toISOString();
      payout.status = "cancelled";
      payout.cancelledAt = cancelledAt;
      payout.cancelledBy = callerId.trim();

      emitCancellationWebhook({
        event: "payout.cancelled",
        payoutId,
        workspaceId: payout.workspaceId,
        cancelledBy: callerId.trim(),
        cancelledAt,
      });

      return res.status(200).json({
        success: true,
        data: {
          payoutId,
          status: payout.status,
          cancelledAt,
          cancelledBy: payout.cancelledBy,
        },
      });
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
  webhookLog.length = 0;
}

export function __getPayout(id: string): Payout | undefined {
  return payouts.get(id);
}

export function __getWebhookLog(): WebhookEvent[] {
  return webhookLog;
}

export default router;
