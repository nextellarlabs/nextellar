import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedExpense,
  __getExpense,
  __getPayoutDrafts,
  __resetExpenses,
} from "../routes/lancepay.expenses.approve.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /lancepay/expenses/:id/approve", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetExpenses();
  });

  it("approves an expense and queues a reimbursement payout draft", async () => {
    __seedExpense({
      id: "exp-1",
      workspaceId: "ws-1",
      amount: 125,
      status: "submitted",
      approverId: undefined,
    });

    const res = await request(app)
      .post("/lancepay/expenses/exp-1/approve")
      .send({ approverId: "approver-1", approverRole: "workspace-approver" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("approved");
    expect(res.body.data.payoutDraftQueued).toBe(true);

    const expense = __getExpense("exp-1");
    expect(expense?.status).toBe("approved");
    expect(expense?.approverId).toBe("approver-1");

    const payoutDrafts = __getPayoutDrafts();
    expect(payoutDrafts).toHaveLength(1);
    expect(payoutDrafts[0]).toMatchObject({
      expenseId: "exp-1",
      workspaceId: "ws-1",
      amount: 125,
      status: "draft",
    });
  });

  it("rejects an expense that is already approved", async () => {
    __seedExpense({
      id: "exp-2",
      workspaceId: "ws-1",
      amount: 75,
      status: "approved",
      approverId: "approver-1",
    });

    const res = await request(app)
      .post("/lancepay/expenses/exp-2/approve")
      .send({ approverId: "approver-2", approverRole: "workspace-approver" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_APPROVED");
  });

  it("rejects a non-approver", async () => {
    __seedExpense({
      id: "exp-3",
      workspaceId: "ws-2",
      amount: 50,
      status: "submitted",
      approverId: undefined,
    });

    const res = await request(app)
      .post("/lancepay/expenses/exp-3/approve")
      .send({ approverId: "user-1", approverRole: "contractor" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});
