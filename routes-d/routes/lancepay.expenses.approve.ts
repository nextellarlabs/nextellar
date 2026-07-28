import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type ExpenseStatus = "submitted" | "approved" | "rejected";

type Expense = {
  id: string;
  workspaceId: string;
  amount: number;
  status: ExpenseStatus;
  approverId?: string;
};

type PayoutDraft = {
  id: string;
  expenseId: string;
  workspaceId: string;
  amount: number;
  status: "draft";
  createdAt: string;
};

type ApproveBody = {
  approverId?: string;
  approverRole?: string;
};

const expenses = new Map<string, Expense>();
const payoutDrafts: PayoutDraft[] = [];

/**
 * POST /lancepay/expenses/:id/approve
 * Approve a submitted LancePay expense and queue a reimbursement draft.
 */
router.post(
  "/lancepay/expenses/:id/approve",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const expenseId = req.params.id?.trim();
      if (!expenseId) {
        sendError(res, "INVALID_EXPENSE_ID", "expenseId is required", 400);
        return;
      }

      const body = req.body as ApproveBody;
      const approverId = typeof body.approverId === "string" ? body.approverId.trim() : "";
      const approverRole = typeof body.approverRole === "string" ? body.approverRole.trim() : "";

      if (!approverId || approverRole !== "workspace-approver") {
        sendError(res, "FORBIDDEN", "workspace approver role required", 403);
        return;
      }

      const expense = expenses.get(expenseId);
      if (!expense) {
        sendError(res, "NOT_FOUND", "Expense not found", 404);
        return;
      }

      if (expense.status === "approved") {
        sendError(res, "ALREADY_APPROVED", "Expense is already approved", 409);
        return;
      }

      expense.status = "approved";
      expense.approverId = approverId;

      const payoutDraft: PayoutDraft = {
        id: `payout-${expense.id}-${Date.now()}`,
        expenseId: expense.id,
        workspaceId: expense.workspaceId,
        amount: expense.amount,
        status: "draft",
        createdAt: new Date().toISOString(),
      };
      payoutDrafts.push(payoutDraft);

      return res.status(200).json({
        success: true,
        data: {
          expenseId: expense.id,
          status: expense.status,
          approverId: expense.approverId,
          payoutDraftQueued: true,
          payoutDraftId: payoutDraft.id,
        },
        message: "Expense approved and reimbursement payout draft queued",
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedExpense(expense: Expense): void {
  expenses.set(expense.id, { ...expense });
}

export function __getExpense(id: string): Expense | undefined {
  return expenses.get(id);
}

export function __getPayoutDrafts(): PayoutDraft[] {
  return payoutDrafts.slice();
}

export function __resetExpenses(): void {
  expenses.clear();
  payoutDrafts.length = 0;
}

export default router;
