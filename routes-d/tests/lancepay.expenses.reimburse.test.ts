import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __resetExpenses,
  __resetReimbursements,
  __seedExpense,
} from "../routes/lancepay.expenses.reimburse.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /lancepay/expenses/:id/reimburse", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetExpenses();
    __resetReimbursements();
  });

  it("reimburses an approved expense from workspace funds", async () => {
    __seedExpense({
      id: "exp-1",
      workspaceId: "ws-1",
      contractorId: "con-1",
      amount: 125,
      currency: "USD",
      status: "approved",
    });

    const res = await request(app).post("/lancepay/expenses/exp-1/reimburse");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.expenseId).toBe("exp-1");
    expect(res.body.data.status).toBe("reimbursed");
    expect(res.body.data.payment.fromWorkspaceId).toBe("ws-1");
    expect(res.body.data.payment.toContractorId).toBe("con-1");
  });

  it("returns an idempotent response for a duplicate reimbursement request", async () => {
    __seedExpense({
      id: "exp-2",
      workspaceId: "ws-1",
      contractorId: "con-2",
      amount: 250,
      currency: "USD",
      status: "approved",
    });

    const first = await request(app).post("/lancepay/expenses/exp-2/reimburse");
    const second = await request(app).post("/lancepay/expenses/exp-2/reimburse");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it("rejects reimbursement for an unapproved expense", async () => {
    __seedExpense({
      id: "exp-3",
      workspaceId: "ws-1",
      contractorId: "con-3",
      amount: 90,
      currency: "USD",
      status: "pending",
    });

    const res = await request(app).post("/lancepay/expenses/exp-3/reimburse");

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EXPENSE_NOT_APPROVED");
  });
});
