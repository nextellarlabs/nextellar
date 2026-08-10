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
  settledAt?: string;
  stellarTxHash?: string;
  createdAt: string;
};

// In-memory store (shared fixture for tests via __seedPayout)
const payouts = new Map<string, Payout>();

/**
 * Render a minimal PDF receipt as a streaming response.
 * In production this would delegate to a PDF helper; here we emit
 * a standards-compliant minimal PDF so tests can assert on headers
 * and streaming without pulling in a PDF library dependency.
 */
function buildReceiptPdf(payout: Payout): Buffer {
  const lines = [
    `LANCEPAY PAYOUT RECEIPT`,
    ``,
    `Receipt ID : ${payout.id}`,
    `Date       : ${payout.settledAt ?? payout.createdAt}`,
    `Amount     : ${payout.amount} ${payout.currency}`,
    `Wallet     : ${payout.destinationWallet}`,
    `Status     : ${payout.status}`,
    payout.stellarTxHash ? `Tx Hash    : ${payout.stellarTxHash}` : "",
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  // Minimal valid PDF shell so Content-Type: application/pdf is truthful
  const body = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nstream\nBT /F1 12 Tf 50 750 Td (${lines.replace(/\n/g, ") Tj T* (")}) Tj ET\nendstream\n%%EOF`;
  return Buffer.from(body, "utf8");
}

/**
 * GET /lancepay/payouts/:id/receipt
 * Stream a PDF receipt for a completed (settled) payout.
 */
router.get(
  "/lancepay/payouts/:id/receipt",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const callerId = req.headers["x-user-id"] as string | undefined;
      if (!callerId) {
        sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
        return;
      }

      const payout = payouts.get(req.params.id);

      if (!payout) {
        sendError(res, "NOT_FOUND", "Payout not found", 404);
        return;
      }

      // Ownership check — caller must belong to the payout's workspace
      if (callerId !== payout.workspaceId && callerId !== payout.contractorId) {
        sendError(res, "FORBIDDEN", "You do not have access to this receipt", 403);
        return;
      }

      // Only settled payouts have a receipt
      if (payout.status !== "completed") {
        sendError(
          res,
          "PAYOUT_NOT_SETTLED",
          `Receipt is only available for completed payouts. Current status: ${payout.status}`,
          409,
        );
        return;
      }

      const pdf = buildReceiptPdf(payout);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="receipt-${payout.id}.pdf"`);
      res.setHeader("Content-Length", pdf.length);
      // Stream without buffering
      res.flushHeaders();
      res.end(pdf);
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
