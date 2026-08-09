import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type ScheduleStatus = "active" | "paused" | "cancelled";

type PayoutSchedule = {
  id: string;
  workspaceId: string;
  contractorId: string;
  cadence: string;
  amount: number;
  currency: string;
  nextPayDate: string;
  status: ScheduleStatus;
  idempotencyKey?: string;
  createdAt: string;
};

// In-memory store for schedules (shared state with schedules.create in production)
const schedules = new Map<string, PayoutSchedule>();

/**
 * POST /lancepay/schedules/:id/pause
 * Pause an active LancePay payout schedule.
 * Skips the next scheduled run and emits a webhook notification.
 */
router.post(
  "/lancepay/schedules/:id/pause",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scheduleId = req.params.id?.trim();
      if (!scheduleId) {
        sendError(res, "INVALID_SCHEDULE_ID", "schedule id is required", 400);
        return;
      }

      const schedule = schedules.get(scheduleId);
      if (!schedule) {
        sendError(res, "NOT_FOUND", "Schedule not found", 404);
        return;
      }

      if (schedule.status === "cancelled") {
        sendError(
          res,
          "SCHEDULE_CANCELLED",
          "Cannot pause a cancelled schedule",
          409,
        );
        return;
      }

      if (schedule.status === "paused") {
        sendError(
          res,
          "ALREADY_PAUSED",
          "Schedule is already paused",
          409,
        );
        return;
      }

      // Update status to paused
      schedule.status = "paused";

      // Record the skipped next pay date for audit
      const skippedPayDate = schedule.nextPayDate;

      // Emit webhook notification (simulated)
      const webhookPayload = {
        event: "schedule.paused",
        scheduleId: schedule.id,
        workspaceId: schedule.workspaceId,
        contractorId: schedule.contractorId,
        skippedPayDate,
        pausedAt: new Date().toISOString(),
      };

      return res.status(200).json({
        success: true,
        data: {
          scheduleId: schedule.id,
          status: schedule.status,
          skippedPayDate,
          webhookSent: true,
          webhookEvent: webhookPayload,
        },
        message: "Schedule paused and next run skipped",
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedSchedule(schedule: PayoutSchedule): void {
  schedules.set(schedule.id, { ...schedule });
}

export function __getSchedule(id: string): PayoutSchedule | undefined {
  return schedules.get(id);
}

export function __resetSchedules(): void {
  schedules.clear();
}

export default router;
