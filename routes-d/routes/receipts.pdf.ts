import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";
import { generateReceiptPdf, TransactionReceiptData } from "../lib/pdfReceipt.js";

const router = Router();

const transactions = new Map<string, TransactionReceiptData>();

// Seed default transaction for testing convenience
const DEFAULT_SEED_TX: TransactionReceiptData = {
  id: "tx-receipt-001",
  userId: "user-123",
  amount: "500.00",
  currency: "USDC",
  status: "completed",
  type: "payment",
  createdAt: "2024-06-01T10:00:00Z",
  completedAt: "2024-06-01T10:02:00Z",
  stellarTxHash: "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef",
  sender: "user-123",
  recipient: "user-456",
  fee: "0.01",
  memo: "Invoice payment #1001",
};

transactions.set(DEFAULT_SEED_TX.id, DEFAULT_SEED_TX);

export function __resetTransactions(): void {
  transactions.clear();
  transactions.set(DEFAULT_SEED_TX.id, DEFAULT_SEED_TX);
}

export function __seedTransaction(tx: TransactionReceiptData): void {
  transactions.set(tx.id, { ...tx });
}

/**
 * GET /receipts/:id/pdf
 * Stream a PDF receipt for a completed transaction.
 * Query param: locale (en | es | fr | de | pt, default: en)
 */
async function handleReceiptPdf(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.headers["x-user-id"] as string | undefined;

    if (!userId) {
      sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
      return;
    }

    const tx = transactions.get(id);

    if (!tx) {
      sendError(res, "NOT_FOUND", "Transaction not found", 404);
      return;
    }

    if (tx.userId !== userId && tx.sender !== userId && tx.recipient !== userId) {
      sendError(res, "FORBIDDEN", "You do not have access to this receipt", 403);
      return;
    }

    if (tx.status !== "completed") {
      sendError(
        res,
        "TRANSACTION_NOT_COMPLETED",
        `Receipt is only available for completed transactions. Current status: ${tx.status}`,
        409,
      );
      return;
    }

    const rawLocale = typeof req.query.locale === "string" ? req.query.locale : "en";
    const pdfBuffer = generateReceiptPdf(tx, rawLocale);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="receipt-${tx.id}.pdf"`);
    res.setHeader("Content-Length", pdfBuffer.length);

    // Stream response without buffering
    res.flushHeaders();
    res.end(pdfBuffer);
  } catch (err) {
    return next(err);
  }
}

router.get("/receipts/:id/pdf", handleReceiptPdf);
router.get("/receipts/:id", handleReceiptPdf);

export default router;
export { transactions };
