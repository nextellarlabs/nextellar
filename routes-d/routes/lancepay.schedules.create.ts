import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

const VALID_CADENCES = new Set(["weekly", "biweekly", "monthly", "quarterly"]);

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

type CreateScheduleBody = {
  workspaceId: string;
  contractorId: string;
  cadence: string;
  amount: number;
  currency: string;
  nextPayDate: string;
  idempotencyKey?: string;
};

// In-memory store
const schedules = new Map<string, PayoutSchedule>();
const idempotencyKeys = new Map<string, string>(); // key -> scheduleId

/**
 * POST /lancepay/schedules
 * Create a recurring payout schedule for a contractor.
 */
router.post(
  "/lancepay/schedules",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as CreateScheduleBody;

      if (!body.workspaceId || typeof body.workspaceId !== "string") {
        sendError(res, "INVALID_WORKSPACE_ID", "workspaceId is required", 400);
        return;
      }

      if (!body.contractorId || typeof body.contractorId !== "string") {
        sendError(res, "INVALID_CONTRACTOR_ID", "contractorId is required", 400);
        return;
      }

      if (!body.cadence || typeof body.cadence !== "string") {
        sendError(res, "INVALID_CADENCE", "cadence is required", 400);
        return;
      }

      const cadence = body.cadence.trim().toLowerCase();
      if (!VALID_CADENCES.has(cadence)) {
        sendError(
          res,
          "INVALID_CADENCE",
          `cadence must be one of: ${[...VALID_CADENCES].join(", ")}`,
          400,
        );
        return;
      }

      if (typeof body.amount !== "number" || body.amount <= 0 || !isFinite(body.amount)) {
        sendError(res, "INVALID_AMOUNT", "amount must be a positive number", 400);
        return;
      }

      if (!body.currency || typeof body.currency !== "string") {
        sendError(res, "INVALID_CURRENCY", "currency is required", 400);
        return;
      }

      if (!body.nextPayDate || typeof body.nextPayDate !== "string") {
        sendError(res, "INVALID_NEXT_PAY_DATE", "nextPayDate is required", 400);
        return;
      }

      const nextPayDate = new Date(body.nextPayDate);
      if (isNaN(nextPayDate.getTime())) {
        sendError(res, "INVALID_NEXT_PAY_DATE", "nextPayDate must be a valid ISO date", 400);
        return;
      }

      if (nextPayDate <= new Date()) {
        sendError(res, "INVALID_NEXT_PAY_DATE", "nextPayDate must be in the future", 400);
        return;
      }

      // Idempotency check
      if (body.idempotencyKey) {
        const existingId = idempotencyKeys.get(body.idempotencyKey);
        if (existingId) {
          const existing = schedules.get(existingId);
          if (existing) {
            return res.status(200).json({ success: true, data: existing, idempotent: true });
          }
        }
        idempotencyKeys.set(body.idempotencyKey, ""); // reserve key
      }

      const id = `sched-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const schedule: PayoutSchedule = {
        id,
        workspaceId: body.workspaceId,
        contractorId: body.contractorId,
        cadence,
        amount: body.amount,
        currency: body.currency.trim().toUpperCase(),
        nextPayDate: nextPayDate.toISOString(),
        status: "active",
        idempotencyKey: body.idempotencyKey,
        createdAt: new Date().toISOString(),
      };

      schedules.set(id, schedule);
      if (body.idempotencyKey) {
        idempotencyKeys.set(body.idempotencyKey, id);
      }

      return res.status(201).json({ success: true, data: schedule });
    } catch (err) {
      return next(err);
    }
  },
);

export function __getSchedules(): Map<string, PayoutSchedule> {
  return schedules;
}

export function __resetSchedules(): void {
  schedules.clear();
  idempotencyKeys.clear();
}

export default router;
