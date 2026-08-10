import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, { __seedExpense, __resetExpenses } from "../routes/lancepay.expenses.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /lancepay/expenses", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetExpenses();
  });

  it("returns empty list when no expenses exist", async () => {
    const res = await request(app).get("/lancepay/expenses?workspaceId=ws-1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.hasMore).toBe(false);
    expect(res.body.pagination.nextCursor).toBeNull();
  });

  it("filters by contractorId", async () => {
    __seedExpense({
      id: "e1", workspaceId: "ws-1", contractorId: "c1", category: "travel",
      amount: 100, currency: "USD", status: "submitted", description: "Flight",
      createdAt: "2026-01-01T10:00:00Z",
    });
    __seedExpense({
      id: "e2", workspaceId: "ws-1", contractorId: "c2", category: "office",
      amount: 50, currency: "USD", status: "submitted", description: "Supplies",
      createdAt: "2026-01-02T10:00:00Z",
    });

    const res = await request(app).get(
      "/lancepay/expenses?workspaceId=ws-1&contractorId=c1",
    );
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe("e1");
  });

  it("filters by category", async () => {
    __seedExpense({
      id: "e1", workspaceId: "ws-1", contractorId: "c1", category: "Travel",
      amount: 100, currency: "USD", status: "submitted", description: "Flight",
      createdAt: "2026-01-01T10:00:00Z",
    });
    __seedExpense({
      id: "e2", workspaceId: "ws-1", contractorId: "c1", category: "Office",
      amount: 50, currency: "USD", status: "submitted", description: "Supplies",
      createdAt: "2026-01-02T10:00:00Z",
    });

    const res = await request(app).get(
      "/lancepay/expenses?workspaceId=ws-1&category=travel",
    );
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe("e1");
  });

  it("filters by status", async () => {
    __seedExpense({
      id: "e1", workspaceId: "ws-1", contractorId: "c1", category: "travel",
      amount: 100, currency: "USD", status: "submitted", description: "Flight",
      createdAt: "2026-01-01T10:00:00Z",
    });
    __seedExpense({
      id: "e2", workspaceId: "ws-1", contractorId: "c1", category: "office",
      amount: 50, currency: "USD", status: "approved", description: "Supplies",
      createdAt: "2026-01-02T10:00:00Z",
    });

    const res = await request(app).get(
      "/lancepay/expenses?workspaceId=ws-1&status=approved",
    );
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe("e2");
  });

  it("returns 400 for invalid status", async () => {
    const res = await request(app).get(
      "/lancepay/expenses?workspaceId=ws-1&status=unknown",
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });

  it("filters by date range", async () => {
    __seedExpense({
      id: "e1", workspaceId: "ws-1", contractorId: "c1", category: "travel",
      amount: 100, currency: "USD", status: "submitted", description: "Flight",
      createdAt: "2026-01-01T10:00:00Z",
    });
    __seedExpense({
      id: "e2", workspaceId: "ws-1", contractorId: "c1", category: "office",
      amount: 50, currency: "USD", status: "submitted", description: "Supplies",
      createdAt: "2026-01-05T10:00:00Z",
    });
    __seedExpense({
      id: "e3", workspaceId: "ws-1", contractorId: "c1", category: "meals",
      amount: 75, currency: "USD", status: "submitted", description: "Lunch",
      createdAt: "2026-01-10T10:00:00Z",
    });

    const res = await request(app).get(
      "/lancepay/expenses?workspaceId=ws-1&startDate=2026-01-02T00:00:00Z&endDate=2026-01-08T00:00:00Z",
    );
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe("e2");
  });

  it("paginates and sorts by submission time descending", async () => {
    for (let i = 1; i <= 5; i++) {
      const day = String(i).padStart(2, "0");
      __seedExpense({
        id: `e${i}`,
        workspaceId: "ws-1",
        contractorId: "c1",
        category: "travel",
        amount: i * 100,
        currency: "USD",
        status: "submitted",
        description: `Expense ${i}`,
        createdAt: `2026-01-${day}T10:00:00Z`,
      });
    }

    const res1 = await request(app).get(
      "/lancepay/expenses?workspaceId=ws-1&limit=2",
    );
    expect(res1.body.data.length).toBe(2);
    expect(res1.body.data[0].id).toBe("e5");
    expect(res1.body.data[1].id).toBe("e4");
    expect(res1.body.pagination.hasMore).toBe(true);
    expect(res1.body.pagination.nextCursor).toBe("e4");

    const res2 = await request(app).get(
      `/lancepay/expenses?workspaceId=ws-1&limit=2&cursor=${res1.body.pagination.nextCursor}`,
    );
    expect(res2.body.data.length).toBe(2);
    expect(res2.body.data[0].id).toBe("e3");
    expect(res2.body.data[1].id).toBe("e2");
    expect(res2.body.pagination.hasMore).toBe(true);

    const res3 = await request(app).get(
      `/lancepay/expenses?workspaceId=ws-1&limit=2&cursor=${res2.body.pagination.nextCursor}`,
    );
    expect(res3.body.data.length).toBe(1);
    expect(res3.body.data[0].id).toBe("e1");
    expect(res3.body.pagination.hasMore).toBe(false);
  });

  it("requires workspaceId", async () => {
    const res = await request(app).get("/lancepay/expenses");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
