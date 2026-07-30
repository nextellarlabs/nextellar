import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type InvoiceStatus = "draft" | "pending" | "paid" | "voided" | "expired";

interface Invoice {
  id: string;
  issuerId: string;
  payerId: string;
  status: InvoiceStatus;
  amount: number;
  currency: string;
  dueDate: Date;
  createdAt: Date;
  paidAt?: Date;
  stellarTxHash?: string;
}

const invoices = new Map<string, Invoice>();
// Idempotency: track (invoiceId, payerId) pairs that already completed
const paidPairs = new Set<string>();

export function __resetInvoices(): void {
  invoices.clear();
  paidPairs.clear();
}

export function __seedInvoice(inv: Invoice): void {
  invoices.set(inv.id, { ...inv });
}

export function __getInvoice(id: string): Invoice | undefined {
  return invoices.get(id);
}

/**
 * POST /invoices/:id/pay
 * Mark an open invoice as paid. Idempotent: a second call from the same
 * payer on the same invoice returns the existing paid record.
 */
router.post(
  "/invoices/:id/pay",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.headers["x-user-id"] as string | undefined;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
        return;
      }

      const invoice = invoices.get(id);

      if (!invoice) {
        sendError(res, "NOT_FOUND", "Invoice not found", 404);
        return;
      }

      if (invoice.payerId !== userId) {
        sendError(res, "FORBIDDEN", "Only the invoice payer can pay this invoice", 403);
        return;
      }

      // Idempotency: already paid by this payer
      const pairKey = `${id}:${userId}`;
      if (paidPairs.has(pairKey)) {
        return res.status(200).json({
          success: true,
          data: {
            id: invoice.id,
            status: invoice.status,
            paidAt: invoice.paidAt,
            stellarTxHash: invoice.stellarTxHash,
          },
          idempotent: true,
        });
      }

      if (invoice.status === "paid") {
        sendError(res, "ALREADY_PAID", "Invoice has already been paid", 409);
        return;
      }

      if (invoice.status === "voided") {
        sendError(res, "INVOICE_VOIDED", "Cannot pay a voided invoice", 409);
        return;
      }

      if (invoice.status === "expired" || invoice.dueDate < new Date()) {
        sendError(res, "INVOICE_EXPIRED", "Cannot pay an expired invoice", 409);
        return;
      }

      if (invoice.status === "draft") {
        sendError(res, "INVOICE_NOT_PAYABLE", "Invoice is still in draft state", 409);
        return;
      }

      const now = new Date();
      const txHash = `stellar-tx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      invoice.status = "paid";
      invoice.paidAt = now;
      invoice.stellarTxHash = txHash;

      paidPairs.add(pairKey);

      return res.status(200).json({
        success: true,
        data: {
          id: invoice.id,
          status: "paid",
          paidAt: now,
          stellarTxHash: txHash,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
export { invoices };
