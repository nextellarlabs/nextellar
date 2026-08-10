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
  pausedAt?: string;
};

type WebhookEvent = {
  event: string;
  scheduleId: string;
  timestamp: string;
};

// In-memory store
const schedules = new Map<string, PayoutSchedule>();
const emittedWebhooks: WebhookEvent[] = [];

/**
 * Calculate the next pay date based on the cadence and current date.
 */
function calculateNextPayDate(cadence: string, now: Date = new Date()): string {
  const nextDate = new Date(now);
  
  switch (cadence.toLowerCase()) {
    case "weekly":
      nextDate.setDate(nextDate.getDate() + 7);
      break;
    case "biweekly":
      nextDate.setDate(nextDate.getDate() + 14);
      break;
    case "monthly":
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;
    case "quarterly":
      nextDate.setMonth(nextDate.getMonth() + 3);
      break;
    default:
      throw new Error(`Unknown cadence: ${cadence}`);
  }
  
  return nextDate.toISOString();
}

/**
 * POST /lancepay/schedules/:id/resume
 * Resume a paused payout schedule.
 * Recalculates next-pay-date based on cadence and now.
 * Emits a resume webhook.
 */
router.post(
  "/lancepay/schedules/:id/resume",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      if (!id || typeof id !== "string") {
        sendError(res, "INVALID_SCHEDULE_ID", "Schedule ID is required", 400);
        return;
      }

      const schedule = schedules.get(id);

      if (!schedule) {
        sendError(res, "SCHEDULE_NOT_FOUND", "Schedule not found", 404);
        return;
      }

      if (schedule.status !== "paused") {
        sendError(
          res,
          "SCHEDULE_NOT_PAUSED",
          `Cannot resume schedule with status: ${schedule.status}`,
          400,
        );
        return;
      }

      // Resume the schedule
      schedule.status = "active";
      schedule.nextPayDate = calculateNextPayDate(schedule.cadence);
      delete schedule.pausedAt;

      // Emit webhook event
      const webhookEvent: WebhookEvent = {
        event: "schedule.resumed",
        scheduleId: id,
        timestamp: new Date().toISOString(),
      };
      emittedWebhooks.push(webhookEvent);

      return res.status(200).json({
        success: true,
        data: schedule,
      });
    } catch (err) {
      return next(err);
    }
  },
);

// Export for testing
export function __getSchedules(): Map<string, PayoutSchedule> {
  return schedules;
}

export function __getEmittedWebhooks(): WebhookEvent[] {
  return emittedWebhooks;
}

export function __resetSchedules(): void {
  schedules.clear();
  emittedWebhooks.length = 0;
}

export function __seedSchedule(schedule: PayoutSchedule): void {
  schedules.set(schedule.id, schedule);
}

export default router;
