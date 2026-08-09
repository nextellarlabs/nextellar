import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type ExpenseStatus = "submitted" | "approved" | "rejected";

type Expense = {
  id: string;
  workspaceId: string;
  contractorId: string;
  category: string;
  amount: number;
  currency: string;
  status: ExpenseStatus;
  description: string;
  receiptUrl?: string;
  createdAt: string;
};

// In-memory store for expenses
const expenses = new Map<string, Expense>();

/**
 * GET /lancepay/expenses
 * List LancePay expenses visible to the caller.
 * Query params: contractorId, category, status, startDate, endDate, limit, cursor
 */
router.get(
  "/lancepay/expenses",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        workspaceId,
        contractorId,
        category,
        status,
        startDate,
        endDate,
        limit = "50",
        cursor,
      } = req.query;

      if (!workspaceId || typeof workspaceId !== "string") {
        sendError(res, "UNAUTHORIZED", "workspaceId query is required", 401);
        return;
      }

      let results = Array.from(expenses.values()).filter(
        (e) => e.workspaceId === workspaceId,
      );

      if (contractorId && typeof contractorId === "string") {
        results = results.filter((e) => e.contractorId === contractorId);
      }

      if (category && typeof category === "string") {
        results = results.filter(
          (e) => e.category.toLowerCase() === category.toLowerCase(),
        );
      }

      if (status && typeof status === "string") {
        const normalized = status.toLowerCase();
        const validStatuses: ExpenseStatus[] = [
          "submitted",
          "approved",
          "rejected",
        ];
        if (
          validStatuses.includes(normalized as ExpenseStatus)
        ) {
          results = results.filter((e) => e.status === normalized);
        } else {
          sendError(
            res,
            "INVALID_STATUS",
            "status must be one of: submitted, approved, rejected",
            400,
          );
          return;
        }
      }

      if (startDate && typeof startDate === "string") {
        const start = new Date(startDate).getTime();
        if (!isNaN(start)) {
          results = results.filter(
            (e) => new Date(e.createdAt).getTime() >= start,
          );
        }
      }

      if (endDate && typeof endDate === "string") {
        const end = new Date(endDate).getTime();
        if (!isNaN(end)) {
          results = results.filter(
            (e) => new Date(e.createdAt).getTime() <= end,
          );
        }
      }

      // Sort by submission time descending
      results.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      // Cursor-based pagination
      if (cursor && typeof cursor === "string") {
        const cursorIndex = results.findIndex((e) => e.id === cursor);
        if (cursorIndex !== -1) {
          results = results.slice(cursorIndex + 1);
        }
      }

      const parsedLimit = parseInt(limit as string, 10);
      const limitNum = isNaN(parsedLimit) || parsedLimit <= 0 ? 50 : Math.min(parsedLimit, 100);

      const hasMore = results.length > limitNum;
      if (hasMore) {
        results = results.slice(0, limitNum);
      }

      const nextCursor = results.length > 0 ? results[results.length - 1].id : null;

      return res.status(200).json({
        success: true,
        data: results,
        pagination: {
          nextCursor,
          hasMore,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedExpense(expense: Expense): void {
  expenses.set(expense.id, { ...expense });
}

export function __resetExpenses(): void {
  expenses.clear();
}

export default router;
