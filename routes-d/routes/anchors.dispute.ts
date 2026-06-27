import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type DisputeReasonCode =
  | "TRANSACTION_NOT_RECEIVED"
  | "INCORRECT_AMOUNT"
  | "DUPLICATE_TRANSACTION"
  | "UNAUTHORIZED_TRANSACTION"
  | "ANCHOR_TIMEOUT";

interface Dispute {
  id: string;
  anchorTransactionId: string;
  userId: string;
  reasonCode: DisputeReasonCode;
  status: "open" | "resolved" | "rejected";
  openedAt: string;
}

const VALID_REASON_CODES = new Set<DisputeReasonCode>([
  "TRANSACTION_NOT_RECEIVED",
  "INCORRECT_AMOUNT",
  "DUPLICATE_TRANSACTION",
  "UNAUTHORIZED_TRANSACTION",
  "ANCHOR_TIMEOUT",
]);

const disputeStore = new Map<string, Dispute>();
// Key: `${userId}:${anchorTransactionId}` -> dispute id (for duplicate detection)
const disputeIndex = new Map<string, string>();

let disputeCounter = 0;

function generateDisputeId(): string {
  disputeCounter += 1;
  return `dispute-${String(disputeCounter).padStart(6, "0")}`;
}

export function __resetDisputeStore(): void {
  disputeStore.clear();
  disputeIndex.clear();
  disputeCounter = 0;
}

export function __seedDispute(dispute: Dispute): void {
  disputeStore.set(dispute.id, dispute);
  const key = `${dispute.userId}:${dispute.anchorTransactionId}`;
  disputeIndex.set(key, dispute.id);
}

const alertOperators = (dispute: Dispute): void => {
  // Alerting hook: in production this would notify operators
  if (process.env.NODE_ENV !== "test") {
    console.log(`[ALERT] New anchor dispute opened: ${dispute.id}`, {
      disputeId: dispute.id,
      anchorTransactionId: dispute.anchorTransactionId,
      reasonCode: dispute.reasonCode,
    });
  }
};

router.post(
  "/anchors/dispute",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers["x-user-id"] as string | undefined;
      const freshAuth = req.headers["x-fresh-auth"] as string | undefined;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
        return;
      }

      if (!freshAuth || freshAuth !== "true") {
        sendError(
          res,
          "FRESH_AUTH_REQUIRED",
          "x-fresh-auth: true header is required to open a dispute",
          401,
        );
        return;
      }

      const { anchorTransactionId, reasonCode } = req.body as {
        anchorTransactionId?: unknown;
        reasonCode?: unknown;
      };

      if (!anchorTransactionId || typeof anchorTransactionId !== "string") {
        sendError(
          res,
          "INVALID_TRANSACTION_ID",
          "anchorTransactionId is required and must be a string",
          400,
        );
        return;
      }

      if (!reasonCode || typeof reasonCode !== "string") {
        sendError(res, "INVALID_REASON_CODE", "reasonCode is required", 400);
        return;
      }

      if (!VALID_REASON_CODES.has(reasonCode as DisputeReasonCode)) {
        sendError(
          res,
          "INVALID_REASON_CODE",
          `reasonCode must be one of: ${[...VALID_REASON_CODES].join(", ")}`,
          400,
        );
        return;
      }

      const indexKey = `${userId}:${anchorTransactionId}`;
      const existingId = disputeIndex.get(indexKey);
      if (existingId) {
        sendError(
          res,
          "DUPLICATE_DISPUTE",
          "A dispute for this transaction is already open",
          409,
        );
        return;
      }

      const id = generateDisputeId();
      const dispute: Dispute = {
        id,
        anchorTransactionId,
        userId,
        reasonCode: reasonCode as DisputeReasonCode,
        status: "open",
        openedAt: new Date().toISOString(),
      };

      disputeStore.set(id, dispute);
      disputeIndex.set(indexKey, id);

      alertOperators(dispute);

      res.status(201).json({
        success: true,
        data: dispute,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
