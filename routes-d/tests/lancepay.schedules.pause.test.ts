import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedSchedule,
  __getSchedule,
  __resetSchedules,
} from "../routes/lancepay.schedules.pause.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const FUTURE_DATE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

describe("POST /lancepay/schedules/:id/pause", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetSchedules();
  });

  it("pauses an active schedule and skips the next run", async () => {
    __seedSchedule({
      id: "sched-1",
      workspaceId: "ws-1",
      contractorId: "con-1",
      cadence: "monthly",
      amount: 3000,
      currency: "USD",
      nextPayDate: FUTURE_DATE,
      status: "active",
      createdAt: "2026-01-01T10:00:00Z",
    });

    const res = await request(app).post("/lancepay/schedules/sched-1/pause");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("paused");
    expect(res.body.data.skippedPayDate).toBe(FUTURE_DATE);
    expect(res.body.data.webhookSent).toBe(true);
    expect(res.body.data.webhookEvent.event).toBe("schedule.paused");
    expect(res.body.data.webhookEvent.scheduleId).toBe("sched-1");

    // Verify the schedule was actually updated in the store
    const updated = __getSchedule("sched-1");
    expect(updated?.status).toBe("paused");
  });

  it("rejects pausing a schedule that is already paused", async () => {
    __seedSchedule({
      id: "sched-2",
      workspaceId: "ws-1",
      contractorId: "con-1",
      cadence: "weekly",
      amount: 500,
      currency: "USD",
      nextPayDate: FUTURE_DATE,
      status: "paused",
      createdAt: "2026-01-01T10:00:00Z",
    });

    const res = await request(app).post("/lancepay/schedules/sched-2/pause");

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_PAUSED");
  });

  it("rejects pausing a cancelled schedule", async () => {
    __seedSchedule({
      id: "sched-3",
      workspaceId: "ws-1",
      contractorId: "con-1",
      cadence: "monthly",
      amount: 2000,
      currency: "USD",
      nextPayDate: FUTURE_DATE,
      status: "cancelled",
      createdAt: "2026-01-01T10:00:00Z",
    });

    const res = await request(app).post("/lancepay/schedules/sched-3/pause");

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SCHEDULE_CANCELLED");
  });

  it("returns 404 for a non-existent schedule", async () => {
    const res = await request(app).post(
      "/lancepay/schedules/non-existent-id/pause",
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 when schedule id is empty", async () => {
    const res = await request(app).post("/lancepay/schedules/   /pause");

    expect(res.status).toBe(400);
    // Trimmed empty should be caught
    expect(res.body.error.code).toBe("INVALID_SCHEDULE_ID");
  });
});
