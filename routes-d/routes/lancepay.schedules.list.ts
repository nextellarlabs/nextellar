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

const schedules = new Map<string, PayoutSchedule>();

/**
 * GET /lancepay/schedules
 * List recurring payout schedules for the calling LancePay workspace.
 * Query params: contractorId, status, page, limit
 */
router.get(
  "/lancepay/schedules",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { contractorId, status, page = "1", limit = "20" } = req.query;

      const pageNum = parseInt(String(page), 10);
      const limitNum = parseInt(String(limit), 10);

      if (isNaN(pageNum) || pageNum < 1) {
        sendError(res, "INVALID_PAGE", "page must be a positive integer", 400);
        return;
      }

      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        sendError(res, "INVALID_LIMIT", "limit must be between 1 and 100", 400);
        return;
      }

      let filtered = Array.from(schedules.values());

      if (contractorId && typeof contractorId === "string") {
        filtered = filtered.filter((s) => s.contractorId === contractorId.trim());
      }

      if (status && typeof status === "string") {
        const validStatuses: ScheduleStatus[] = ["active", "paused", "cancelled"];
        const trimmed = status.trim().toLowerCase() as ScheduleStatus;
        if (!validStatuses.includes(trimmed)) {
          sendError(
            res,
            "INVALID_STATUS",
            `status must be one of: ${validStatuses.join(", ")}`,
            400,
          );
          return;
        }
        filtered = filtered.filter((s) => s.status === trimmed);
      }

      filtered.sort((a, b) => {
        const aTime = new Date(a.nextPayDate).getTime();
        const bTime = new Date(b.nextPayDate).getTime();
        return aTime - bTime;
      });

      const offset = (pageNum - 1) * limitNum;
      const paged = filtered.slice(offset, offset + limitNum);

      return res.status(200).json({
        success: true,
        data: paged,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: filtered.length,
          hasNext: offset + limitNum < filtered.length,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedSchedule(s: PayoutSchedule): void {
  schedules.set(s.id, { ...s });
}

export function __resetSchedules(): void {
  schedules.clear();
}

export function __getSchedules(): Map<string, PayoutSchedule> {
  return schedules;
}

export default router;
