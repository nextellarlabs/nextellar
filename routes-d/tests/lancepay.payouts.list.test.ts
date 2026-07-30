import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, { __seedPayout, __resetPayouts } from "../routes/lancepay.payouts.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /lancepay/payouts", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetPayouts();
  });

  it("returns empty list when no payouts exist", async () => {
    const res = await request(app).get("/lancepay/payouts?workspaceId=ws-1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.hasMore).toBe(false);
  });

  it("filters by contractor, currency, and status", async () => {
    __seedPayout({ id: "p1", workspaceId: "ws-1", contractorId: "c1", destinationWallet: "W1", amount: 100, currency: "USD", status: "completed", createdAt: "2026-01-01T10:00:00Z" });
    __seedPayout({ id: "p2", workspaceId: "ws-1", contractorId: "c1", destinationWallet: "W1", amount: 200, currency: "EUR", status: "pending", createdAt: "2026-01-01T11:00:00Z" });
    __seedPayout({ id: "p3", workspaceId: "ws-1", contractorId: "c2", destinationWallet: "W2", amount: 300, currency: "USD", status: "completed", createdAt: "2026-01-01T12:00:00Z" });

    let res = await request(app).get("/lancepay/payouts?workspaceId=ws-1&contractorId=c1");
    expect(res.body.data.length).toBe(2);

    res = await request(app).get("/lancepay/payouts?workspaceId=ws-1&currency=USD");
    expect(res.body.data.length).toBe(2);

    res = await request(app).get("/lancepay/payouts?workspaceId=ws-1&status=pending");
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe("p2");
  });

  it("filters by date range", async () => {
    __seedPayout({ id: "p1", workspaceId: "ws-1", contractorId: "c1", destinationWallet: "W1", amount: 100, currency: "USD", status: "completed", createdAt: "2026-01-01T10:00:00Z" });
    __seedPayout({ id: "p2", workspaceId: "ws-1", contractorId: "c1", destinationWallet: "W1", amount: 200, currency: "USD", status: "completed", createdAt: "2026-01-05T10:00:00Z" });
    __seedPayout({ id: "p3", workspaceId: "ws-1", contractorId: "c1", destinationWallet: "W1", amount: 300, currency: "USD", status: "completed", createdAt: "2026-01-10T10:00:00Z" });

    const res = await request(app).get("/lancepay/payouts?workspaceId=ws-1&startDate=2026-01-02T00:00:00Z&endDate=2026-01-08T00:00:00Z");
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe("p2");
  });

  it("paginates and sorts by submission time descending", async () => {
    __seedPayout({ id: "p1", workspaceId: "ws-1", contractorId: "c1", destinationWallet: "W1", amount: 100, currency: "USD", status: "completed", createdAt: "2026-01-01T10:00:00Z" });
    __seedPayout({ id: "p2", workspaceId: "ws-1", contractorId: "c1", destinationWallet: "W1", amount: 200, currency: "USD", status: "completed", createdAt: "2026-01-02T10:00:00Z" });
    __seedPayout({ id: "p3", workspaceId: "ws-1", contractorId: "c1", destinationWallet: "W1", amount: 300, currency: "USD", status: "completed", createdAt: "2026-01-03T10:00:00Z" });

    const res1 = await request(app).get("/lancepay/payouts?workspaceId=ws-1&limit=2");
    expect(res1.body.data.length).toBe(2);
    expect(res1.body.data[0].id).toBe("p3");
    expect(res1.body.data[1].id).toBe("p2");
    expect(res1.body.pagination.hasMore).toBe(true);
    expect(res1.body.pagination.nextCursor).toBe("2026-01-02T10:00:00Z");

    const res2 = await request(app).get(`/lancepay/payouts?workspaceId=ws-1&limit=2&cursor=${res1.body.pagination.nextCursor}`);
    expect(res2.body.data.length).toBe(1);
    expect(res2.body.data[0].id).toBe("p1");
    expect(res2.body.pagination.hasMore).toBe(false);
  });
});
