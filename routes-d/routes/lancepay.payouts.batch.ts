import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";
import crypto from "crypto";

const router = Router();

const VALID_CURRENCIES = new Set(["USD", "EUR", "GBP", "XLM", "USDC"]);
const MAX_BATCH_SIZE = 500;

type PayoutStatus = "pending" | "failed";

type PayoutItem = {
  contractorId: string;
  destinationWallet: string;
  amount: number;
  currency: string;
};

type PayoutOutcome = {
  index: number;
  contractorId: string;
  status: PayoutStatus;
  payoutId?: string;
  error?: string;
};

type BatchResult = {
  batchId: string;
  contentHash: string;
  total: number;
  succeeded: number;
  failed: number;
  outcomes: PayoutOutcome[];
  idempotent: boolean;
};

// In-memory store: contentHash -> BatchResult
const batchResults = new Map<string, BatchResult>();

function hashContent(items: PayoutItem[]): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(items))
    .digest("hex");
}

function validateItem(item: unknown, index: number): string | null {
  const i = item as Record<string, unknown>;
  if (!i.contractorId || typeof i.contractorId !== "string") {
    return `item[${index}]: contractorId is required`;
  }
  if (!i.destinationWallet || typeof i.destinationWallet !== "string") {
    return `item[${index}]: destinationWallet is required`;
  }
  const wallet = (i.destinationWallet as string).trim();
  if (!/^(G[A-Z2-7]{55}|0x[0-9a-fA-F]{40})$/.test(wallet)) {
    return `item[${index}]: invalid destinationWallet format`;
  }
  if (typeof i.amount !== "number" || i.amount <= 0 || !isFinite(i.amount)) {
    return `item[${index}]: amount must be a positive number`;
  }
  if (!i.currency || typeof i.currency !== "string") {
    return `item[${index}]: currency is required`;
  }
  const currency = (i.currency as string).trim().toUpperCase();
  if (!VALID_CURRENCIES.has(currency)) {
    return `item[${index}]: unsupported currency ${currency}`;
  }
  return null;
}

/**
 * POST /lancepay/payouts/batch
 * Submit a batch of payouts in one request. Returns per-row outcomes.
 * Idempotent: re-uploading the same payload (by SHA-256 content hash) returns
 * the cached result without re-processing.
 */
router.post(
  "/lancepay/payouts/batch",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as { payouts?: unknown[]; workspaceId?: string };

      if (!body.workspaceId || typeof body.workspaceId !== "string") {
        sendError(res, "INVALID_WORKSPACE_ID", "workspaceId is required", 400);
        return;
      }

      if (!Array.isArray(body.payouts)) {
        sendError(res, "INVALID_PAYOUTS", "payouts must be an array", 400);
        return;
      }

      if (body.payouts.length === 0) {
        sendError(res, "EMPTY_BATCH", "payouts array must not be empty", 400);
        return;
      }

      if (body.payouts.length > MAX_BATCH_SIZE) {
        sendError(
          res,
          "BATCH_TOO_LARGE",
          `Batch size ${body.payouts.length} exceeds maximum of ${MAX_BATCH_SIZE}`,
          400,
        );
        return;
      }

      const contentHash = hashContent(body.payouts as PayoutItem[]);

      // Idempotency: same content hash → return cached result
      const cached = batchResults.get(contentHash);
      if (cached) {
        return res.status(200).json({ success: true, data: { ...cached, idempotent: true } });
      }

      // Stream-process each row
      const outcomes: PayoutOutcome[] = [];
      let succeeded = 0;
      let failed = 0;

      for (let i = 0; i < body.payouts.length; i++) {
        const item = body.payouts[i] as Record<string, unknown>;
        const validationError = validateItem(item, i);

        if (validationError) {
          outcomes.push({
            index: i,
            contractorId: typeof item.contractorId === "string" ? item.contractorId : "",
            status: "failed",
            error: validationError,
          });
          failed++;
          continue;
        }

        const payoutId = `pay-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
        outcomes.push({
          index: i,
          contractorId: item.contractorId as string,
          status: "pending",
          payoutId,
        });
        succeeded++;
      }

      const result: BatchResult = {
        batchId:     `batch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        contentHash,
        total:       body.payouts.length,
        succeeded,
        failed,
        outcomes,
        idempotent:  false,
      };

      batchResults.set(contentHash, result);

      const status = failed > 0 && succeeded === 0 ? 422 : 201;
      return res.status(status).json({ success: true, data: result });
    } catch (err) {
      return next(err);
    }
  },
);

export function __getBatchResults(): Map<string, BatchResult> {
  return batchResults;
}

export function __resetBatchResults(): void {
  batchResults.clear();
}

export default router;
