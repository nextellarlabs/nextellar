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
 * GET /invoices
 * List invoices visible to the calling user (as issuer or payer).
 * Query params: status, from, to, page, limit
 * Results are sorted by createdAt descending (newest first).
 */
router.get(
  "/invoices",
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "User not authenticated", 401);
        return;
      }

      const { status, from, to, page = "1", limit = "20" } = req.query;

      const pageNum = parseInt(String(page), 10);
      const limitNum = parseInt(String(limit), 10);

      if (isNaN(pageNum) || pageNum < 1) {
        sendError(res, "INVALID_PAGE", "page must be a positive integer", 400);
        return;
      }

      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        sendError(res, "INVALID_LIMIT", "limit must be between 1 and 100", 400);
        return;
      }

      let fromDate: Date | undefined;
      let toDate: Date | undefined;

      if (from) {
        fromDate = new Date(String(from));
        if (isNaN(fromDate.getTime())) {
          sendError(res, "INVALID_DATE", "from must be a valid ISO date", 400);
          return;
        }
      }

      if (to) {
        toDate = new Date(String(to));
        if (isNaN(toDate.getTime())) {
          sendError(res, "INVALID_DATE", "to must be a valid ISO date", 400);
          return;
        }
      }

      // Only return invoices where the caller is the issuer or payer
      let filtered = Array.from(invoices.values()).filter(
        (inv) => inv.issuerId === userId || inv.payerId === userId,
      );

      if (status && typeof status === "string") {
        filtered = filtered.filter((inv) => inv.status === status.trim());
      }

      if (fromDate) {
        filtered = filtered.filter((inv) => inv.createdAt >= fromDate!);
      }

      if (toDate) {
        filtered = filtered.filter((inv) => inv.createdAt <= toDate!);
      }

      // Sort newest first
      filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      const total = filtered.length;
      const offset = (pageNum - 1) * limitNum;
      const paged = filtered.slice(offset, offset + limitNum);

      res.status(200).json({
        success: true,
        data: paged,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          hasNext: offset + limitNum < total,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
export { invoices };
