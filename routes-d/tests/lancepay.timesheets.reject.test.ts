import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedTimesheet,
  __getTimesheet,
  __resetTimesheets,
  __getRejectionNotifications,
  __resetRejectionNotifications,
} from "../routes/lancepay.timesheets.reject.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

describe("POST /lancepay/timesheets/:id/reject", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetTimesheets();
    __resetRejectionNotifications();
  });

  it("rejects a pending timesheet with valid reason code and comment", async () => {
    __seedTimesheet({
      id: "ts1",
      contractorId: "con1",
      workspaceId: "ws1",
      status: "pending",
      hours: 40,
      projectId: "proj1",
      weekStart: "2024-01-01",
      submittedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post("/lancepay/timesheets/ts1/reject")
      .set("x-admin-id", "admin1")
      .send({
        reasonCode: "incomplete_hours",
        comment: "Missing hours for Friday",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.timesheetId).toBe("ts1");
    expect(res.body.data.status).toBe("rejected");
    expect(res.body.data.reasonCode).toBe("incomplete_hours");
    expect(res.body.data.comment).toBe("Missing hours for Friday");
    expect(res.body.message).toBe("Timesheet rejected and contractor notified");

    const timesheet = __getTimesheet("ts1");
    expect(timesheet?.status).toBe("rejected");

    const notifications = __getRejectionNotifications();
    expect(notifications.length).toBe(1);
    expect(notifications[0].contractorId).toBe("con1");
    expect(notifications[0].timesheetId).toBe("ts1");
    expect(notifications[0].reasonCode).toBe("incomplete_hours");
    expect(notifications[0].comment).toBe("Missing hours for Friday");
    expect(notifications[0].rejectedBy).toBe("admin1");
  });

  it("rejects request when reasonCode is missing", async () => {
    __seedTimesheet({
      id: "ts1",
      contractorId: "con1",
      workspaceId: "ws1",
      status: "pending",
      hours: 40,
      projectId: "proj1",
      weekStart: "2024-01-01",
      submittedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post("/lancepay/timesheets/ts1/reject")
      .set("x-admin-id", "admin1")
      .send({
        comment: "Missing hours for Friday",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_REASON_CODE");
  });

  it("rejects request when comment is missing", async () => {
    __seedTimesheet({
      id: "ts1",
      contractorId: "con1",
      workspaceId: "ws1",
      status: "pending",
      hours: 40,
      projectId: "proj1",
      weekStart: "2024-01-01",
      submittedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post("/lancepay/timesheets/ts1/reject")
      .set("x-admin-id", "admin1")
      .send({
        reasonCode: "incomplete_hours",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_COMMENT");
  });

  it("rejects request when reasonCode is invalid", async () => {
    __seedTimesheet({
      id: "ts1",
      contractorId: "con1",
      workspaceId: "ws1",
      status: "pending",
      hours: 40,
      projectId: "proj1",
      weekStart: "2024-01-01",
      submittedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post("/lancepay/timesheets/ts1/reject")
      .set("x-admin-id", "admin1")
      .send({
        reasonCode: "invalid_reason",
        comment: "Missing hours for Friday",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REASON_CODE");
  });

  it("rejects request when comment is empty", async () => {
    __seedTimesheet({
      id: "ts1",
      contractorId: "con1",
      workspaceId: "ws1",
      status: "pending",
      hours: 40,
      projectId: "proj1",
      weekStart: "2024-01-01",
      submittedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post("/lancepay/timesheets/ts1/reject")
      .set("x-admin-id", "admin1")
      .send({
        reasonCode: "incomplete_hours",
        comment: "   ",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_COMMENT");
  });

  it("rejects request when comment exceeds 1000 characters", async () => {
    __seedTimesheet({
      id: "ts1",
      contractorId: "con1",
      workspaceId: "ws1",
      status: "pending",
      hours: 40,
      projectId: "proj1",
      weekStart: "2024-01-01",
      submittedAt: new Date().toISOString(),
    });

    const longComment = "a".repeat(1001);

    const res = await request(app)
      .post("/lancepay/timesheets/ts1/reject")
      .set("x-admin-id", "admin1")
      .send({
        reasonCode: "incomplete_hours",
        comment: longComment,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_COMMENT");
  });

  it("rejects unauthorized caller (no adminId)", async () => {
    __seedTimesheet({
      id: "ts1",
      contractorId: "con1",
      workspaceId: "ws1",
      status: "pending",
      hours: 40,
      projectId: "proj1",
      weekStart: "2024-01-01",
      submittedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post("/lancepay/timesheets/ts1/reject")
      .send({
        reasonCode: "incomplete_hours",
        comment: "Missing hours for Friday",
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects request when timesheet is not found", async () => {
    const res = await request(app)
      .post("/lancepay/timesheets/nonexistent/reject")
      .set("x-admin-id", "admin1")
      .send({
        reasonCode: "incomplete_hours",
        comment: "Missing hours for Friday",
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects request when timesheet is not in pending status", async () => {
    __seedTimesheet({
      id: "ts1",
      contractorId: "con1",
      workspaceId: "ws1",
      status: "approved",
      hours: 40,
      projectId: "proj1",
      weekStart: "2024-01-01",
      submittedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post("/lancepay/timesheets/ts1/reject")
      .set("x-admin-id", "admin1")
      .send({
        reasonCode: "incomplete_hours",
        comment: "Missing hours for Friday",
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_STATUS");
  });

  it("accepts all valid reason codes", async () => {
    const validReasonCodes = [
      "incomplete_hours",
      "missing_project",
      "unapproved_overtime",
      "incorrect_dates",
      "duplicate_submission",
      "quality_issue",
      "policy_violation",
      "other",
    ];

    for (const reasonCode of validReasonCodes) {
      __resetTimesheets();
      __resetRejectionNotifications();

      __seedTimesheet({
        id: "ts1",
        contractorId: "con1",
        workspaceId: "ws1",
        status: "pending",
        hours: 40,
        projectId: "proj1",
        weekStart: "2024-01-01",
        submittedAt: new Date().toISOString(),
      });

      const res = await request(app)
        .post("/lancepay/timesheets/ts1/reject")
        .set("x-admin-id", "admin1")
        .send({
          reasonCode,
          comment: "Test comment",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.reasonCode).toBe(reasonCode);
    }
  });
});
