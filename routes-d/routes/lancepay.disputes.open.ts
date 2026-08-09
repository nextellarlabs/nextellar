import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

const VALID_REASON_CODES = new Set([
  "unauthorized_transaction",
  "incorrect_amount",
  "duplicate_payment",
  "service_not_provided",
  "goods_not_received",
  "other",
]);

type DisputeStatus = "open" | "under_review" | "resolved" | "rejected";

type Dispute = {
  id: string;
  payoutId: string;
  workspaceId: string;
  reasonCode: string;
  evidenceAttachments: string[];
  status: DisputeStatus;
  createdAt: string;
};

type PayoutStatus = "pending" | "processing" | "completed" | "failed";

type Payout = {
  id: string;
  workspaceId: string;
  status: PayoutStatus;
  frozenForDispute?: boolean;
};

type OpenDisputeBody = {
  payoutId: string;
  workspaceId: string;
  reasonCode: string;
  evidenceAttachments: string[];
};

const disputes = new Map<string, Dispute>();
const payouts = new Map<string, Payout>();
const disputeKeys = new Map<string, string>(); // payoutId -> disputeId

/**
 * POST /lancepay/disputes
 * Open a dispute against a specific LancePay payout.
 */
router.post(
  "/lancepay/disputes",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as OpenDisputeBody;

      if (!body.payoutId || typeof body.payoutId !== "string") {
        sendError(res, "INVALID_PAYOUT_ID", "payoutId is required", 400);
        return;
      }

      if (!body.workspaceId || typeof body.workspaceId !== "string") {
        sendError(res, "INVALID_WORKSPACE_ID", "workspaceId is required", 400);
        return;
      }

      if (!body.reasonCode || typeof body.reasonCode !== "string") {
        sendError(res, "INVALID_REASON_CODE", "reasonCode is required", 400);
        return;
      }

      const reasonCode = body.reasonCode.trim();
      if (!VALID_REASON_CODES.has(reasonCode)) {
        sendError(
          res,
          "INVALID_REASON_CODE",
          `reasonCode must be one of: ${[...VALID_REASON_CODES].join(", ")}`,
          400,
        );
        return;
      }

      if (!Array.isArray(body.evidenceAttachments) || body.evidenceAttachments.length === 0) {
        sendError(
          res,
          "INVALID_EVIDENCE",
          "evidenceAttachments must be a non-empty array",
          400,
        );
        return;
      }

      for (const url of body.evidenceAttachments) {
        if (typeof url !== "string" || !url.trim()) {
          sendError(
            res,
            "INVALID_EVIDENCE",
            "evidenceAttachments must contain non-empty strings",
            400,
          );
          return;
        }
      }

      const payout = payouts.get(body.payoutId);
      if (!payout) {
        sendError(res, "NOT_FOUND", "Payout not found", 404);
        return;
      }

      // Check for duplicate dispute (payout already has an open dispute)
      const existingDisputeId = disputeKeys.get(body.payoutId);
      if (existingDisputeId) {
        const existing = disputes.get(existingDisputeId);
        if (existing && existing.status === "open") {
          sendError(
            res,
            "DUPLICATE_DISPUTE",
            "A dispute for this payout is already open",
            409,
          );
          return;
        }
      }

      const dispute: Dispute = {
        id: `disp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        payoutId: body.payoutId,
        workspaceId: body.workspaceId,
        reasonCode,
        evidenceAttachments: body.evidenceAttachments.map((u) => u.trim()),
        status: "open",
        createdAt: new Date().toISOString(),
      };

      disputes.set(dispute.id, dispute);
      disputeKeys.set(body.payoutId, dispute.id);
      payout.frozenForDispute = true;

      return res.status(201).json({ success: true, data: dispute });
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

export function __resetDisputes(): void {
  disputes.clear();
  disputeKeys.clear();
}

export function __getPayout(id: string): Payout | undefined {
  return payouts.get(id);
}

export default router;