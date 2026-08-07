import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

const VALID_CATEGORIES = new Set([
  "travel",
  "office_supplies",
  "software",
  "equipment",
  "services",
  "other",
]);

const VALID_CURRENCIES = new Set(["USD", "EUR", "GBP", "XLM", "USDC"]);

const MAX_EXPENSE_AMOUNT = 10_000;

type ExpenseRecord = {
  id: string;
  contractorId: string;
  category: string;
  currency: string;
  amount: number;
  description: string;
  receiptId: string;
  status: "submitted" | "approved" | "rejected";
  createdAt: string;
};

type CreateExpenseBody = {
  contractorId: string;
  category: string;
  currency: string;
  amount: number;
  description?: string;
  receiptId: string;
};

const expenses = new Map<string, ExpenseRecord>();

/**
 * POST /lancepay/expenses
 * Submit a reimbursable expense with an attached receipt.
 * Validates category, currency, and receipt id; rejects oversize amounts.
 * Expenses are persisted under the calling contractor only.
 */
router.post(
  "/lancepay/expenses",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const callerId = req.headers["x-user-id"] as string | undefined;
      if (!callerId) {
        sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
        return;
      }

      const body = req.body as CreateExpenseBody;

      if (!body.contractorId || typeof body.contractorId !== "string") {
        sendError(res, "INVALID_CONTRACTOR_ID", "contractorId is required", 400);
        return;
      }

      if (body.contractorId !== callerId) {
        sendError(
          res,
          "FORBIDDEN",
          "You can only submit expenses for yourself",
          403,
        );
        return;
      }

      if (!body.category || typeof body.category !== "string") {
        sendError(res, "INVALID_CATEGORY", "category is required", 400);
        return;
      }

      const category = body.category.trim().toLowerCase();
      if (!VALID_CATEGORIES.has(category)) {
        sendError(
          res,
          "INVALID_CATEGORY",
          `category must be one of: ${[...VALID_CATEGORIES].join(", ")}`,
          400,
        );
        return;
      }

      if (!body.currency || typeof body.currency !== "string") {
        sendError(res, "INVALID_CURRENCY", "currency is required", 400);
        return;
      }

      const currency = body.currency.trim().toUpperCase();
      if (!VALID_CURRENCIES.has(currency)) {
        sendError(
          res,
          "INVALID_CURRENCY",
          `currency must be one of: ${[...VALID_CURRENCIES].join(", ")}`,
          400,
        );
        return;
      }

      if (typeof body.amount !== "number" || !isFinite(body.amount)) {
        sendError(res, "INVALID_AMOUNT", "amount must be a number", 400);
        return;
      }

      if (body.amount <= 0) {
        sendError(res, "INVALID_AMOUNT", "amount must be a positive number", 400);
        return;
      }

      if (body.amount > MAX_EXPENSE_AMOUNT) {
        sendError(
          res,
          "AMOUNT_EXCEEDS_LIMIT",
          `amount must not exceed ${MAX_EXPENSE_AMOUNT}`,
          400,
        );
        return;
      }

      if (!body.receiptId || typeof body.receiptId !== "string") {
        sendError(res, "MISSING_RECEIPT", "receiptId is required", 400);
        return;
      }

      const id = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const expense: ExpenseRecord = {
        id,
        contractorId: body.contractorId,
        category,
        currency,
        amount: body.amount,
        description: (body.description ?? "").trim(),
        receiptId: body.receiptId.trim(),
        status: "submitted",
        createdAt: new Date().toISOString(),
      };

      expenses.set(id, expense);

      return res.status(201).json({ success: true, data: expense });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedExpense(e: ExpenseRecord): void {
  expenses.set(e.id, { ...e });
}

export function __resetExpenses(): void {
  expenses.clear();
}

export function __getExpenses(): Map<string, ExpenseRecord> {
  return expenses;
}

export default router;
