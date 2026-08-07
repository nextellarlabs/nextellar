import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type TimesheetStatus = "pending" | "approved" | "rejected";

export type Timesheet = {
  id: string;
  workspaceId: string;
  contractorId: string;
  status: TimesheetStatus;
  amount: number;
  currency: string;
};

// In-memory store
const timesheets = new Map<string, Timesheet>();
const queuedPayouts = new Set<string>(); // Keep track of queued payouts by timesheet ID

/**
 * POST /lancepay/timesheets/:id/approve
 * Approve a submitted LancePay timesheet and queue the resulting payout draft.
 */
router.post(
  "/lancepay/timesheets/:id/approve",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const timesheetId = (req.params.id as string)?.trim();
      if (!timesheetId) {
        sendError(res, "INVALID_TIMESHEET_ID", "timesheetId is required", 400);
        return;
      }

      const approverId = req.body.approverId || req.headers["x-approver-id"];
      if (!approverId || typeof approverId !== "string" || !approverId.trim()) {
        sendError(res, "UNAUTHORIZED", "workspace approver identity required", 403);
        return;
      }

      const timesheet = timesheets.get(timesheetId);
      if (!timesheet) {
        sendError(res, "NOT_FOUND", "Timesheet not found", 404);
        return;
      }

      if (timesheet.status === "approved") {
        return res.status(200).json({
          success: true,
          data: { timesheetId, status: timesheet.status },
          message: "Already approved",
        });
      }

      if (timesheet.status !== "pending") {
        sendError(res, "INVALID_STATUS", "Timesheet is not pending approval", 400);
        return;
      }

      timesheet.status = "approved";
      queuedPayouts.add(timesheetId); // Queue the matching payout draft for the multi-approver flow

      return res.status(200).json({
        success: true,
        data: {
          timesheetId,
          status: timesheet.status,
          payoutQueued: true,
        },
        message: "Timesheet approved and payout draft queued",
      });
    } catch (err) {
      return next(err);
    }
  }
);

export function __seedTimesheet(t: Timesheet): void {
  timesheets.set(t.id, t);
}

export function __getTimesheet(id: string): Timesheet | undefined {
  return timesheets.get(id);
}

export function __isPayoutQueued(timesheetId: string): boolean {
  return queuedPayouts.has(timesheetId);
}

export function __resetTimesheets(): void {
  timesheets.clear();
  queuedPayouts.clear();
}

export default router;
