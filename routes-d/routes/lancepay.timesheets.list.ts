import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type TimesheetStatus = "draft" | "submitted" | "approved" | "rejected" | "paid";

type TimesheetRecord = {
  id: string;
  workspaceId: string;
  contractorId: string;
  status: TimesheetStatus;
  payPeriodStart: string;
  payPeriodEnd: string;
  hoursWorked: number;
  amountDue: number;
  currency: string;
  submittedAt: string;
  createdAt: string;
};

const timesheets = new Map<string, TimesheetRecord>();

/**
 * GET /lancepay/timesheets
 * List timesheets visible to the caller through their workspace.
 * Query params: contractorId, status, payPeriodStart, payPeriodEnd, page, limit
 * Paginated and sorted by submission time (submittedAt) descending.
 */
router.get(
  "/lancepay/timesheets",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceId = req.headers["x-workspace-id"] as string | undefined;
      
      if (!workspaceId) {
        sendError(res, "UNAUTHORIZED", "x-workspace-id header is required", 401);
        return;
      }

      const { 
        contractorId, 
        status, 
        payPeriodStart,
        payPeriodEnd,
        page = "1", 
        limit = "20" 
      } = req.query;

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

      // Start with timesheets for this workspace
      let filtered = Array.from(timesheets.values()).filter(
        (t) => t.workspaceId === workspaceId
      );

      // Filter by contractorId
      if (contractorId && typeof contractorId === "string") {
        filtered = filtered.filter((t) => t.contractorId === contractorId.trim());
      }

      // Filter by status
      if (status && typeof status === "string") {
        filtered = filtered.filter((t) => t.status === status.trim());
      }

      // Filter by pay period start date
      if (payPeriodStart && typeof payPeriodStart === "string") {
        const startDate = new Date(payPeriodStart);
        if (isNaN(startDate.getTime())) {
          sendError(res, "INVALID_DATE", "payPeriodStart must be a valid ISO 8601 date", 400);
          return;
        }
        filtered = filtered.filter((t) => {
          const tStart = new Date(t.payPeriodStart);
          return tStart >= startDate;
        });
      }

      // Filter by pay period end date
      if (payPeriodEnd && typeof payPeriodEnd === "string") {
        const endDate = new Date(payPeriodEnd);
        if (isNaN(endDate.getTime())) {
          sendError(res, "INVALID_DATE", "payPeriodEnd must be a valid ISO 8601 date", 400);
          return;
        }
        filtered = filtered.filter((t) => {
          const tEnd = new Date(t.payPeriodEnd);
          return tEnd <= endDate;
        });
      }

      // Sort by submission time descending (most recent first)
      filtered.sort((a, b) => {
        const aTime = new Date(a.submittedAt).getTime();
        const bTime = new Date(b.submittedAt).getTime();
        return bTime - aTime;
      });

      // Paginate
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
  }
);

// Test helpers
export function __seedTimesheet(t: TimesheetRecord): void {
  timesheets.set(t.id, { ...t });
}

export function __resetTimesheets(): void {
  timesheets.clear();
}

export function __getTimesheets(): Map<string, TimesheetRecord> {
  return timesheets;
}

export default router;
