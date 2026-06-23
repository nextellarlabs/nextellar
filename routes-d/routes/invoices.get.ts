import { Router, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest } from "../../backend/middleware/auth.js";
import { sendError } from "../../backend/utils/response.js";

const router = Router();

type InvoiceStatus = "draft" | "pending" | "paid" | "voided";

interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface Invoice {
  id: string;
  issuerId: string;
  payerId: string;
  status: InvoiceStatus;
  amount: number;
  currency: string;
  lineItems: InvoiceLineItem[];
  createdAt: Date;
  dueDate: Date;
  paidAt?: Date;
  stellarTxHash?: string;
}

// Mock storage for invoices
const invoices = new Map<string, Invoice>();

/**
 * GET /invoices/:id
 * Return a single invoice with line items and status.
 * Restricted access to the invoice issuer or its payer.
 * Includes payment status and any related Stellar tx hash.
 */
router.get(
  "/:id",
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user?.sub;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "User not authenticated", 401);
        return;
      }

      const invoice = invoices.get(id);

      if (!invoice) {
        sendError(res, "NOT_FOUND", "Invoice not found", 404);
        return;
      }

      // Restrict access to the invoice issuer or its payer
      if (invoice.issuerId !== userId && invoice.payerId !== userId) {
        sendError(
          res,
          "FORBIDDEN",
          "You do not have access to this invoice",
          403
        );
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          id: invoice.id,
          issuerId: invoice.issuerId,
          payerId: invoice.payerId,
          status: invoice.status,
          amount: invoice.amount,
          currency: invoice.currency,
          lineItems: invoice.lineItems,
          createdAt: invoice.createdAt,
          dueDate: invoice.dueDate,
          paidAt: invoice.paidAt,
          stellarTxHash: invoice.stellarTxHash,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
export { invoices };
