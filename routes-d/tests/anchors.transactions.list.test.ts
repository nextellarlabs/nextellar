import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __resetTransactions,
  __seedTransactions,
} from "../routes/anchors.transactions.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /anchors/transactions", () => {
  const app = buildApp();
  const authHeader = { "x-user-id": "user-001" };

  beforeEach(() => {
    __resetTransactions();
  });

  it("returns empty list when no transactions exist", async () => {
    __seedTransactions("user-empty", []);
    const res = await request(app)
      .get("/anchors/transactions")
      .set("x-user-id", "user-empty");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it("returns all transactions for a user", async () => {
    const res = await request(app)
      .get("/anchors/transactions")
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(2);
  });

  it("filters by anchor", async () => {
    const res = await request(app)
      .get("/anchors/transactions?anchor=anchor-circle")
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].anchorId).toBe("anchor-circle");
  });

  it("filters by status", async () => {
    const res = await request(app)
      .get("/anchors/transactions?status=pending")
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].status).toBe("pending");
  });

  it("filters by both anchor and status", async () => {
    const res = await request(app)
      .get("/anchors/transactions?anchor=anchor-circle&status=failed")
      .set("x-user-id", "user-002");

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].status).toBe("failed");
    expect(res.body.data[0].anchorId).toBe("anchor-circle");
  });

  it("paginates results correctly", async () => {
    const manyTransactions = Array.from({ length: 25 }, (_, i) => ({
      id: `tx-${i}`,
      userId: "user-001",
      anchorId: "anchor-circle",
      status: "completed" as const,
      amount: "100.00",
      currency: "USDC",
      type: "deposit" as const,
      startedAt: new Date(Date.now() - i * 1000).toISOString(),
    }));
    __seedTransactions("user-001", manyTransactions);

    const res = await request(app)
      .get("/anchors/transactions?page=1&limit=10")
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(10);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(10);
    expect(res.body.pagination.total).toBe(25);
    expect(res.body.pagination.totalPages).toBe(3);
  });

  it("sorts by startedAt descending (newest first)", async () => {
    const res = await request(app)
      .get("/anchors/transactions")
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe("tx-002"); // 2024-06-02
    expect(res.body.data[1].id).toBe("tx-001"); // 2024-06-01
  });

  it("returns 401 when x-user-id header is missing", async () => {
    const res = await request(app).get("/anchors/transactions");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 INVALID_STATUS for unrecognized status", async () => {
    const res = await request(app)
      .get("/anchors/transactions?status=unknown")
      .set(authHeader);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });

  it("returns 400 INVALID_PAGINATION for page 0", async () => {
    const res = await request(app)
      .get("/anchors/transactions?page=0")
      .set(authHeader);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAGINATION");
  });

  it("returns 400 INVALID_PAGINATION for limit over max", async () => {
    const res = await request(app)
      .get("/anchors/transactions?limit=200")
      .set(authHeader);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAGINATION");
  });

  it("response data has the expected shape", async () => {
    const res = await request(app)
      .get("/anchors/transactions")
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.pagination).toHaveProperty("page");
    expect(res.body.pagination).toHaveProperty("limit");
    expect(res.body.pagination).toHaveProperty("total");
    expect(res.body.pagination).toHaveProperty("totalPages");

    const tx = res.body.data[0];
    expect(tx).toHaveProperty("id");
    expect(tx).toHaveProperty("userId");
    expect(tx).toHaveProperty("anchorId");
    expect(tx).toHaveProperty("status");
    expect(tx).toHaveProperty("amount");
    expect(tx).toHaveProperty("currency");
    expect(tx).toHaveProperty("type");
    expect(tx).toHaveProperty("startedAt");
  });
});