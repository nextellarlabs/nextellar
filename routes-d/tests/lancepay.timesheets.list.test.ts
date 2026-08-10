import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedTimesheet,
  __resetTimesheets,
  __getTimesheets,
} from "../routes/lancepay.timesheets.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("GET /lancepay/timesheets", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetTimesheets();
  });

  it("returns empty list when no timesheets exist", async () => {
    const res = await request(app)
      .get("/lancepay/timesheets")
      .set("x-workspace-id", "ws-1");
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it("returns 401 when x-workspace-id header is missing", async () => {
    const res = await request(app).get("/lancepay/timesheets");
    
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns all timesheets for workspace when no filters applied", async () => {
    __seedTimesheet({
      id: "ts-1",
      workspaceId: "ws-1",
      contractorId: "con-1",
      status: "submitted",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 80,
      amountDue: 4000,
      currency: "USD",
      submittedAt: new Date(Date.now() - 1000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    __seedTimesheet({
      id: "ts-2",
      workspaceId: "ws-1",
      contractorId: "con-2",
      status: "approved",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 60,
      amountDue: 3000,
      currency: "USD",
      submittedAt: new Date(Date.now() - 2000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/lancepay/timesheets")
      .set("x-workspace-id", "ws-1");
    
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination.total).toBe(2);
  });

  it("filters timesheets by workspace (does not leak across workspaces)", async () => {
    __seedTimesheet({
      id: "ts-1",
      workspaceId: "ws-1",
      contractorId: "con-1",
      status: "submitted",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 80,
      amountDue: 4000,
      currency: "USD",
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    __seedTimesheet({
      id: "ts-2",
      workspaceId: "ws-2",
      contractorId: "con-1",
      status: "submitted",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 60,
      amountDue: 3000,
      currency: "USD",
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/lancepay/timesheets")
      .set("x-workspace-id", "ws-1");
    
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe("ts-1");
  });

  it("filters by contractorId", async () => {
    __seedTimesheet({
      id: "ts-1",
      workspaceId: "ws-1",
      contractorId: "con-1",
      status: "submitted",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 80,
      amountDue: 4000,
      currency: "USD",
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    __seedTimesheet({
      id: "ts-2",
      workspaceId: "ws-1",
      contractorId: "con-2",
      status: "submitted",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 60,
      amountDue: 3000,
      currency: "USD",
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/lancepay/timesheets?contractorId=con-1")
      .set("x-workspace-id", "ws-1");
    
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].contractorId).toBe("con-1");
  });

  it("filters by status", async () => {
    __seedTimesheet({
      id: "ts-1",
      workspaceId: "ws-1",
      contractorId: "con-1",
      status: "submitted",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 80,
      amountDue: 4000,
      currency: "USD",
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    __seedTimesheet({
      id: "ts-2",
      workspaceId: "ws-1",
      contractorId: "con-2",
      status: "approved",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 60,
      amountDue: 3000,
      currency: "USD",
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/lancepay/timesheets?status=approved")
      .set("x-workspace-id", "ws-1");
    
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].status).toBe("approved");
  });

  it("filters by pay period start date", async () => {
    __seedTimesheet({
      id: "ts-1",
      workspaceId: "ws-1",
      contractorId: "con-1",
      status: "submitted",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 80,
      amountDue: 4000,
      currency: "USD",
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    __seedTimesheet({
      id: "ts-2",
      workspaceId: "ws-1",
      contractorId: "con-2",
      status: "submitted",
      payPeriodStart: "2026-02-01T00:00:00Z",
      payPeriodEnd: "2026-02-15T23:59:59Z",
      hoursWorked: 60,
      amountDue: 3000,
      currency: "USD",
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/lancepay/timesheets?payPeriodStart=2026-01-15T00:00:00Z")
      .set("x-workspace-id", "ws-1");
    
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe("ts-2");
  });

  it("filters by pay period end date", async () => {
    __seedTimesheet({
      id: "ts-1",
      workspaceId: "ws-1",
      contractorId: "con-1",
      status: "submitted",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 80,
      amountDue: 4000,
      currency: "USD",
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    __seedTimesheet({
      id: "ts-2",
      workspaceId: "ws-1",
      contractorId: "con-2",
      status: "submitted",
      payPeriodStart: "2026-02-01T00:00:00Z",
      payPeriodEnd: "2026-02-28T23:59:59Z",
      hoursWorked: 60,
      amountDue: 3000,
      currency: "USD",
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/lancepay/timesheets?payPeriodEnd=2026-01-31T23:59:59Z")
      .set("x-workspace-id", "ws-1");
    
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe("ts-1");
  });

  it("returns 400 for invalid payPeriodStart date", async () => {
    const res = await request(app)
      .get("/lancepay/timesheets?payPeriodStart=invalid-date")
      .set("x-workspace-id", "ws-1");
    
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DATE");
  });

  it("returns 400 for invalid payPeriodEnd date", async () => {
    const res = await request(app)
      .get("/lancepay/timesheets?payPeriodEnd=not-a-date")
      .set("x-workspace-id", "ws-1");
    
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DATE");
  });

  it("sorts by submission time descending (most recent first)", async () => {
    const now = Date.now();
    __seedTimesheet({
      id: "ts-1",
      workspaceId: "ws-1",
      contractorId: "con-1",
      status: "submitted",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 80,
      amountDue: 4000,
      currency: "USD",
      submittedAt: new Date(now - 5000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    __seedTimesheet({
      id: "ts-2",
      workspaceId: "ws-1",
      contractorId: "con-2",
      status: "submitted",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 60,
      amountDue: 3000,
      currency: "USD",
      submittedAt: new Date(now - 1000).toISOString(),
      createdAt: new Date().toISOString(),
    });
    __seedTimesheet({
      id: "ts-3",
      workspaceId: "ws-1",
      contractorId: "con-3",
      status: "submitted",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 70,
      amountDue: 3500,
      currency: "USD",
      submittedAt: new Date(now - 3000).toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/lancepay/timesheets")
      .set("x-workspace-id", "ws-1");
    
    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe("ts-2"); // most recent
    expect(res.body.data[1].id).toBe("ts-3"); // middle
    expect(res.body.data[2].id).toBe("ts-1"); // oldest
  });

  it("paginates results", async () => {
    for (let i = 1; i <= 25; i++) {
      __seedTimesheet({
        id: `ts-${i}`,
        workspaceId: "ws-1",
        contractorId: `con-${i}`,
        status: "submitted",
        payPeriodStart: "2026-01-01T00:00:00Z",
        payPeriodEnd: "2026-01-15T23:59:59Z",
        hoursWorked: 80,
        amountDue: 4000,
        currency: "USD",
        submittedAt: new Date(Date.now() - i * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      });
    }

    const page1 = await request(app)
      .get("/lancepay/timesheets?page=1&limit=10")
      .set("x-workspace-id", "ws-1");
    
    expect(page1.status).toBe(200);
    expect(page1.body.data.length).toBe(10);
    expect(page1.body.pagination.page).toBe(1);
    expect(page1.body.pagination.limit).toBe(10);
    expect(page1.body.pagination.total).toBe(25);
    expect(page1.body.pagination.hasNext).toBe(true);

    const page2 = await request(app)
      .get("/lancepay/timesheets?page=2&limit=10")
      .set("x-workspace-id", "ws-1");
    
    expect(page2.status).toBe(200);
    expect(page2.body.data.length).toBe(10);
    expect(page2.body.pagination.page).toBe(2);
    expect(page2.body.pagination.hasNext).toBe(true);

    const page3 = await request(app)
      .get("/lancepay/timesheets?page=3&limit=10")
      .set("x-workspace-id", "ws-1");
    
    expect(page3.status).toBe(200);
    expect(page3.body.data.length).toBe(5);
    expect(page3.body.pagination.hasNext).toBe(false);
  });

  it("returns 400 for invalid page", async () => {
    const res = await request(app)
      .get("/lancepay/timesheets?page=0")
      .set("x-workspace-id", "ws-1");
    
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAGE");
  });

  it("returns 400 for invalid limit", async () => {
    const res = await request(app)
      .get("/lancepay/timesheets?limit=101")
      .set("x-workspace-id", "ws-1");
    
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_LIMIT");
  });

  it("combines multiple filters", async () => {
    __seedTimesheet({
      id: "ts-1",
      workspaceId: "ws-1",
      contractorId: "con-1",
      status: "approved",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 80,
      amountDue: 4000,
      currency: "USD",
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    __seedTimesheet({
      id: "ts-2",
      workspaceId: "ws-1",
      contractorId: "con-1",
      status: "submitted",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 60,
      amountDue: 3000,
      currency: "USD",
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    __seedTimesheet({
      id: "ts-3",
      workspaceId: "ws-1",
      contractorId: "con-2",
      status: "approved",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 70,
      amountDue: 3500,
      currency: "USD",
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/lancepay/timesheets?contractorId=con-1&status=approved")
      .set("x-workspace-id", "ws-1");
    
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe("ts-1");
    expect(res.body.data[0].contractorId).toBe("con-1");
    expect(res.body.data[0].status).toBe("approved");
  });

  it("returns empty list when filters match nothing", async () => {
    __seedTimesheet({
      id: "ts-1",
      workspaceId: "ws-1",
      contractorId: "con-1",
      status: "submitted",
      payPeriodStart: "2026-01-01T00:00:00Z",
      payPeriodEnd: "2026-01-15T23:59:59Z",
      hoursWorked: 80,
      amountDue: 4000,
      currency: "USD",
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/lancepay/timesheets?contractorId=non-existent")
      .set("x-workspace-id", "ws-1");
    
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });
});
