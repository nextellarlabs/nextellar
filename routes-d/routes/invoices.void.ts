import { Router, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest } from "../../backend/middleware/auth.js";
import { sendError } from "../../backend/utils/response.js";

const router = Router();

type InvoiceStatus = "draft" | "pending" | "paid" | "voided";

interface Invoice {
  id: string;
  issuerId: string;
  payerId: string;
  status: InvoiceStatus;
  amount: number;
  currency: string;
  createdAt: Date;
  paidAt?: Date;
  stellarTxHash?: string;
}

// Mock storage for invoices
const invoices = new Map<string, Invoice>();

/**
 * POST /invoices/:id/void
 * Void an unpaid invoice.
 * Restricted to the issuer of the invoice.
 * Rejects when the invoice has already been paid.
 */
router.post(
  "/:id/void",
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

      // Restrict to the issuer of the invoice
      if (invoice.issuerId !== userId) {
        sendError(
          res,
          "FORBIDDEN",
          "Only the invoice issuer can void this invoice",
          403
        );
        return;
      }

      // Reject when the invoice has already been paid
      if (invoice.status === "paid") {
        sendError(
          res,
          "INVALID_STATE",
          "Cannot void an invoice that has already been paid",
          400
        );
        return;
      }

      // Update invoice status to voided
      invoice.status = "voided";

      res.status(200).json({
        success: true,
        data: {
          id: invoice.id,
          status: invoice.status,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
export { invoices };
