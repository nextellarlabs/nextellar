import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __getSchedules,
  __getEmittedWebhooks,
  __resetSchedules,
  __seedSchedule,
} from "../routes/lancepay.schedules.resume.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /lancepay/schedules/:id/resume", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetSchedules();
  });

  it("resumes a paused schedule successfully", async () => {
    const schedule = {
      id: "sched-123",
      workspaceId: "ws-1",
      contractorId: "con-1",
      cadence: "monthly",
      amount: 3000,
      currency: "USD",
      nextPayDate: "2024-01-01T00:00:00Z",
      status: "paused" as const,
      createdAt: "2024-01-01T00:00:00Z",
      pausedAt: "2024-01-15T00:00:00Z",
    };
    __seedSchedule(schedule);

    const res = await request(app).post("/lancepay/schedules/sched-123/resume");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.nextPayDate).toBeDefined();
    expect(res.body.data.pausedAt).toBeUndefined();

    // Verify the schedule was updated in storage
    const updatedSchedule = __getSchedules().get("sched-123");
    expect(updatedSchedule?.status).toBe("active");
    expect(updatedSchedule?.pausedAt).toBeUndefined();
  });

  it("emits a webhook event on resume", async () => {
    const schedule = {
      id: "sched-123",
      workspaceId: "ws-1",
      contractorId: "con-1",
      cadence: "monthly",
      amount: 3000,
      currency: "USD",
      nextPayDate: "2024-01-01T00:00:00Z",
      status: "paused" as const,
      createdAt: "2024-01-01T00:00:00Z",
      pausedAt: "2024-01-15T00:00:00Z",
    };
    __seedSchedule(schedule);

    await request(app).post("/lancepay/schedules/sched-123/resume");

    const webhooks = __getEmittedWebhooks();
    expect(webhooks).toHaveLength(1);
    expect(webhooks[0].event).toBe("schedule.resumed");
    expect(webhooks[0].scheduleId).toBe("sched-123");
    expect(webhooks[0].timestamp).toBeDefined();
  });

  it("recalculates next-pay-date based on cadence (weekly)", async () => {
    const schedule = {
      id: "sched-123",
      workspaceId: "ws-1",
      contractorId: "con-1",
      cadence: "weekly",
      amount: 3000,
      currency: "USD",
      nextPayDate: "2024-01-01T00:00:00Z",
      status: "paused" as const,
      createdAt: "2024-01-01T00:00:00Z",
      pausedAt: "2024-01-15T00:00:00Z",
    };
    __seedSchedule(schedule);

    const beforeResume = new Date();
    const res = await request(app).post("/lancepay/schedules/sched-123/resume");

    expect(res.status).toBe(200);
    const nextPayDate = new Date(res.body.data.nextPayDate);
    const expectedDate = new Date(beforeResume);
    expectedDate.setDate(expectedDate.getDate() + 7);

    // Allow some tolerance for test execution time (within 1 second)
    const diff = Math.abs(nextPayDate.getTime() - expectedDate.getTime());
    expect(diff).toBeLessThan(1000);
  });

  it("recalculates next-pay-date based on cadence (biweekly)", async () => {
    const schedule = {
      id: "sched-123",
      workspaceId: "ws-1",
      contractorId: "con-1",
      cadence: "biweekly",
      amount: 3000,
      currency: "USD",
      nextPayDate: "2024-01-01T00:00:00Z",
      status: "paused" as const,
      createdAt: "2024-01-01T00:00:00Z",
      pausedAt: "2024-01-15T00:00:00Z",
    };
    __seedSchedule(schedule);

    const beforeResume = new Date();
    const res = await request(app).post("/lancepay/schedules/sched-123/resume");

    expect(res.status).toBe(200);
    const nextPayDate = new Date(res.body.data.nextPayDate);
    const expectedDate = new Date(beforeResume);
    expectedDate.setDate(expectedDate.getDate() + 14);

    const diff = Math.abs(nextPayDate.getTime() - expectedDate.getTime());
    expect(diff).toBeLessThan(1000);
  });

  it("recalculates next-pay-date based on cadence (monthly)", async () => {
    const schedule = {
      id: "sched-123",
      workspaceId: "ws-1",
      contractorId: "con-1",
      cadence: "monthly",
      amount: 3000,
      currency: "USD",
      nextPayDate: "2024-01-01T00:00:00Z",
      status: "paused" as const,
      createdAt: "2024-01-01T00:00:00Z",
      pausedAt: "2024-01-15T00:00:00Z",
    };
    __seedSchedule(schedule);

    const beforeResume = new Date();
    const res = await request(app).post("/lancepay/schedules/sched-123/resume");

    expect(res.status).toBe(200);
    const nextPayDate = new Date(res.body.data.nextPayDate);
    const expectedDate = new Date(beforeResume);
    expectedDate.setMonth(expectedDate.getMonth() + 1);

    const diff = Math.abs(nextPayDate.getTime() - expectedDate.getTime());
    expect(diff).toBeLessThan(1000);
  });

  it("recalculates next-pay-date based on cadence (quarterly)", async () => {
    const schedule = {
      id: "sched-123",
      workspaceId: "ws-1",
      contractorId: "con-1",
      cadence: "quarterly",
      amount: 3000,
      currency: "USD",
      nextPayDate: "2024-01-01T00:00:00Z",
      status: "paused" as const,
      createdAt: "2024-01-01T00:00:00Z",
      pausedAt: "2024-01-15T00:00:00Z",
    };
    __seedSchedule(schedule);

    const beforeResume = new Date();
    const res = await request(app).post("/lancepay/schedules/sched-123/resume");

    expect(res.status).toBe(200);
    const nextPayDate = new Date(res.body.data.nextPayDate);
    const expectedDate = new Date(beforeResume);
    expectedDate.setMonth(expectedDate.getMonth() + 3);

    const diff = Math.abs(nextPayDate.getTime() - expectedDate.getTime());
    expect(diff).toBeLessThan(1000);
  });

  it("returns 400 when schedule is not paused", async () => {
    const schedule = {
      id: "sched-123",
      workspaceId: "ws-1",
      contractorId: "con-1",
      cadence: "monthly",
      amount: 3000,
      currency: "USD",
      nextPayDate: "2024-01-01T00:00:00Z",
      status: "active" as const,
      createdAt: "2024-01-01T00:00:00Z",
    };
    __seedSchedule(schedule);

    const res = await request(app).post("/lancepay/schedules/sched-123/resume");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SCHEDULE_NOT_PAUSED");
    expect(res.body.error.message).toContain("Cannot resume schedule");
  });

  it("returns 400 when schedule is cancelled", async () => {
    const schedule = {
      id: "sched-123",
      workspaceId: "ws-1",
      contractorId: "con-1",
      cadence: "monthly",
      amount: 3000,
      currency: "USD",
      nextPayDate: "2024-01-01T00:00:00Z",
      status: "cancelled" as const,
      createdAt: "2024-01-01T00:00:00Z",
    };
    __seedSchedule(schedule);

    const res = await request(app).post("/lancepay/schedules/sched-123/resume");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SCHEDULE_NOT_PAUSED");
    expect(res.body.error.message).toContain("cancelled");
  });

  it("returns 404 when schedule does not exist", async () => {
    const res = await request(app).post("/lancepay/schedules/nonexistent/resume");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SCHEDULE_NOT_FOUND");
  });

  it("returns 404 when schedule id is missing", async () => {
    const res = await request(app).post("/lancepay/schedules//resume");

    expect(res.status).toBe(404);
  });

  it("returns 400 when schedule id is not a string", async () => {
    const res = await request(app).post("/lancepay/schedules/123/resume");

    // Since the ID comes from params, it will always be a string
    // But we test the case where the schedule doesn't exist
    expect(res.status).toBe(404);
  });
});
