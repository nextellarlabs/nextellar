import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

const VALID_REASON_CODES = new Set([
  "incomplete_hours",
  "missing_project",
  "unapproved_overtime",
  "incorrect_dates",
  "duplicate_submission",
  "quality_issue",
  "policy_violation",
  "other",
]);

type TimesheetStatus = "pending" | "approved" | "rejected" | "paid";

type Timesheet = {
  id: string;
  contractorId: string;
  workspaceId: string;
  status: TimesheetStatus;
  hours: number;
  projectId: string;
  weekStart: string;
  submittedAt: string;
};

type RejectBody = {
  reasonCode: string;
  comment: string;
};

type RejectionNotification = {
  contractorId: string;
  timesheetId: string;
  reasonCode: string;
  comment: string;
  rejectedBy: string;
  rejectedAt: string;
};

// In-memory stores
const timesheets = new Map<string, Timesheet>();
const sentNotifications: RejectionNotification[] = [];

/**
 * Dispatch a rejection notification to the contractor
 */
function dispatchRejectionNotification(
  contractorId: string,
  timesheetId: string,
  reasonCode: string,
  comment: string,
  rejectedBy: string,
): void {
  const notification: RejectionNotification = {
    contractorId,
    timesheetId,
    reasonCode,
    comment,
    rejectedBy,
    rejectedAt: new Date().toISOString(),
  };
  sentNotifications.push(notification);
}

/**
 * POST /lancepay/timesheets/:id/reject
 * Reject a submitted LancePay timesheet with a structured reason code and free-text comment.
 * Notifies the contractor via notification dispatchers.
 */
router.post(
  "/lancepay/timesheets/:id/reject",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const timesheetId = req.params.id?.trim();
      if (!timesheetId) {
        sendError(res, "INVALID_TIMESHEET_ID", "timesheetId is required", 400);
        return;
      }

      const adminId = req.headers["x-admin-id"] as string | undefined;
      if (!adminId || typeof adminId !== "string" || !adminId.trim()) {
        sendError(
          res,
          "UNAUTHORIZED",
          "workspace-admin identity required",
          403,
        );
        return;
      }

      const body = req.body as RejectBody;

      if (!body.reasonCode || typeof body.reasonCode !== "string") {
        sendError(res, "MISSING_REASON_CODE", "reasonCode is required", 400);
        return;
      }

      const reasonCode = body.reasonCode.trim().toLowerCase();
      if (!VALID_REASON_CODES.has(reasonCode)) {
        sendError(
          res,
          "INVALID_REASON_CODE",
          `reasonCode must be one of: ${[...VALID_REASON_CODES].join(", ")}`,
          400,
        );
        return;
      }

      if (!body.comment || typeof body.comment !== "string") {
        sendError(res, "MISSING_COMMENT", "comment is required", 400);
        return;
      }

      const comment = body.comment.trim();
      if (comment.length === 0) {
        sendError(res, "INVALID_COMMENT", "comment cannot be empty", 400);
        return;
      }

      if (comment.length > 1000) {
        sendError(
          res,
          "INVALID_COMMENT",
          "comment must be 1000 characters or less",
          400,
        );
        return;
      }

      const timesheet = timesheets.get(timesheetId);
      if (!timesheet) {
        sendError(res, "NOT_FOUND", "Timesheet not found", 404);
        return;
      }

      if (timesheet.status !== "pending") {
        sendError(
          res,
          "INVALID_STATUS",
          "Only pending timesheets can be rejected",
          400,
        );
        return;
      }

      // Update timesheet status
      timesheet.status = "rejected";

      // Dispatch notification to contractor
      dispatchRejectionNotification(
        timesheet.contractorId,
        timesheetId,
        reasonCode,
        comment,
        adminId.trim(),
      );

      return res.status(200).json({
        success: true,
        data: {
          timesheetId,
          status: timesheet.status,
          reasonCode,
          comment,
          rejectedAt: new Date().toISOString(),
        },
        message: "Timesheet rejected and contractor notified",
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedTimesheet(t: Timesheet): void {
  timesheets.set(t.id, { ...t });
}

export function __getTimesheet(id: string): Timesheet | undefined {
  return timesheets.get(id);
}

export function __resetTimesheets(): void {
  timesheets.clear();
}

export function __getRejectionNotifications(): RejectionNotification[] {
  return sentNotifications;
}

export function __resetRejectionNotifications(): void {
  sentNotifications.length = 0;
}

export default router;
