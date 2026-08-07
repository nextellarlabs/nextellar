import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedSchedule,
  __resetSchedules,
  __getSchedules,
} from "../routes/lancepay.schedules.list.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const FUTURE_DATE = (daysFromNow: number): string =>
  new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();

const makeSchedule = (overrides: Partial<{
  id: string;
  workspaceId: string;
  contractorId: string;
  cadence: string;
  amount: number;
  currency: string;
  nextPayDate: string;
  status: "active" | "paused" | "cancelled";
  createdAt: string;
}> = {}) => ({
  id: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  workspaceId: "ws-1",
  contractorId: "con-1",
  cadence: "monthly",
  amount: 3000,
  currency: "USD",
  nextPayDate: FUTURE_DATE(7),
  status: "active" as const,
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe("GET /lancepay/schedules", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetSchedules();
  });

  it("returns empty list when no schedules exist", async () => {
    const res = await request(app).get("/lancepay/schedules");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it("returns all schedules when no filters applied", async () => {
    __seedSchedule(makeSchedule({ id: "sched-1", contractorId: "con-1" }));
    __seedSchedule(makeSchedule({ id: "sched-2", contractorId: "con-2" }));

    const res = await request(app).get("/lancepay/schedules");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination.total).toBe(2);
  });

  it("filters by contractorId", async () => {
    __seedSchedule(makeSchedule({ id: "sched-1", contractorId: "con-1" }));
    __seedSchedule(makeSchedule({ id: "sched-2", contractorId: "con-2" }));
    __seedSchedule(makeSchedule({ id: "sched-3", contractorId: "con-1" }));

    const res = await request(app).get("/lancepay/schedules?contractorId=con-1");
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data.every((s: { contractorId: string }) => s.contractorId === "con-1")).toBe(true);
  });

  it("filters by status", async () => {
    __seedSchedule(makeSchedule({ id: "sched-1", status: "active" }));
    __seedSchedule(makeSchedule({ id: "sched-2", status: "paused" }));
    __seedSchedule(makeSchedule({ id: "sched-3", status: "cancelled" }));

    const activeRes = await request(app).get("/lancepay/schedules?status=active");
    expect(activeRes.status).toBe(200);
    expect(activeRes.body.data.length).toBe(1);
    expect(activeRes.body.data[0].status).toBe("active");

    const pausedRes = await request(app).get("/lancepay/schedules?status=paused");
    expect(pausedRes.status).toBe(200);
    expect(pausedRes.body.data.length).toBe(1);
    expect(pausedRes.body.data[0].status).toBe("paused");
  });

  it("returns 400 for invalid status", async () => {
    const res = await request(app).get("/lancepay/schedules?status=unknown");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });

  it("sorts by nextPayDate ascending", async () => {
    __seedSchedule(
      makeSchedule({ id: "sched-1", nextPayDate: FUTURE_DATE(30) }),
    );
    __seedSchedule(
      makeSchedule({ id: "sched-2", nextPayDate: FUTURE_DATE(7) }),
    );
    __seedSchedule(
      makeSchedule({ id: "sched-3", nextPayDate: FUTURE_DATE(14) }),
    );

    const res = await request(app).get("/lancepay/schedules");
    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe("sched-2");
    expect(res.body.data[1].id).toBe("sched-3");
    expect(res.body.data[2].id).toBe("sched-1");
  });

  it("paginates results", async () => {
    for (let i = 1; i <= 25; i++) {
      __seedSchedule(
        makeSchedule({
          id: `sched-${i}`,
          contractorId: "con-1",
          nextPayDate: FUTURE_DATE(7 + i),
        }),
      );
    }

    const page1 = await request(app).get("/lancepay/schedules?page=1&limit=10");
    expect(page1.status).toBe(200);
    expect(page1.body.data.length).toBe(10);
    expect(page1.body.pagination.page).toBe(1);
    expect(page1.body.pagination.limit).toBe(10);
    expect(page1.body.pagination.total).toBe(25);
    expect(page1.body.pagination.hasNext).toBe(true);

    const page2 = await request(app).get("/lancepay/schedules?page=2&limit=10");
    expect(page2.status).toBe(200);
    expect(page2.body.data.length).toBe(10);
    expect(page2.body.pagination.page).toBe(2);
    expect(page2.body.pagination.hasNext).toBe(true);

    const page3 = await request(app).get("/lancepay/schedules?page=3&limit=10");
    expect(page3.status).toBe(200);
    expect(page3.body.data.length).toBe(5);
    expect(page3.body.pagination.hasNext).toBe(false);
  });

  it("returns 400 for invalid page", async () => {
    const res = await request(app).get("/lancepay/schedules?page=0");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_PAGE");
  });

  it("returns 400 for invalid limit", async () => {
    const res = await request(app).get("/lancepay/schedules?limit=101");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_LIMIT");
  });

  it("combines contractorId and status filters", async () => {
    __seedSchedule(makeSchedule({ id: "sched-1", contractorId: "con-1", status: "active" }));
    __seedSchedule(makeSchedule({ id: "sched-2", contractorId: "con-1", status: "paused" }));
    __seedSchedule(makeSchedule({ id: "sched-3", contractorId: "con-2", status: "active" }));

    const res = await request(app).get(
      "/lancepay/schedules?contractorId=con-1&status=active",
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe("sched-1");
  });
});
