import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type ExpenseStatus = "pending" | "approved" | "reimbursed";

type Expense = {
  id: string;
  workspaceId: string;
  contractorId: string;
  amount: number;
  currency: string;
  status: ExpenseStatus;
};

type Reimbursement = {
  id: string;
  expenseId: string;
  workspaceId: string;
  contractorId: string;
  amount: number;
  currency: string;
  status: "reimbursed";
  payment: {
    fromWorkspaceId: string;
    toContractorId: string;
    currency: string;
  };
};

const expenses = new Map<string, Expense>();
const reimbursements = new Map<string, Reimbursement>();

export function __seedExpense(expense: Expense): void {
  expenses.set(expense.id, expense);
}

export function __resetExpenses(): void {
  expenses.clear();
}

export function __resetReimbursements(): void {
  reimbursements.clear();
}

router.post(
  "/lancepay/expenses/:id/reimburse",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const expense = expenses.get(id);

      if (!expense) {
        sendError(res, "EXPENSE_NOT_FOUND", `Expense ${id} not found`, 404);
        return;
      }

      if (expense.status !== "approved") {
        sendError(res, "EXPENSE_NOT_APPROVED", "Expense must be approved before reimbursement", 409);
        return;
      }

      const existing = reimbursements.get(id);
      if (existing) {
        return res.status(200).json({ success: true, data: existing, idempotent: true });
      }

      const reimbursement: Reimbursement = {
        id: `reimb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        expenseId: expense.id,
        workspaceId: expense.workspaceId,
        contractorId: expense.contractorId,
        amount: expense.amount,
        currency: expense.currency,
        status: "reimbursed",
        payment: {
          fromWorkspaceId: expense.workspaceId,
          toContractorId: expense.contractorId,
          currency: expense.currency,
        },
      };

      reimbursements.set(id, reimbursement);
      expenses.set(id, { ...expense, status: "reimbursed" });

      return res.status(200).json({ success: true, data: reimbursement });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
