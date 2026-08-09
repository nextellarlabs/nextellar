import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type TimesheetEntry = {
  date: string;
  hours: number;
  projectCode: string;
};

type TimesheetSubmission = {
  id: string;
  contractorId: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  entries: TimesheetEntry[];
  createdAt: string;
};

const timesheets: TimesheetSubmission[] = [];

function parseDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed;
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(parseDate(value).getTime());
}

function isWithinPeriod(entryDate: string, start: string, end: string): boolean {
  const entry = parseDate(entryDate).getTime();
  const periodStart = parseDate(start).getTime();
  const periodEnd = parseDate(end).getTime();
  return entry >= periodStart && entry <= periodEnd;
}

router.post(
  "/lancepay/timesheets",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contractorId = String(req.body?.contractorId ?? "").trim();
      const payPeriodStart = String(req.body?.payPeriodStart ?? "").trim();
      const payPeriodEnd = String(req.body?.payPeriodEnd ?? "").trim();
      const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];

      if (!contractorId) {
        sendError(res, "INVALID_CONTRACTOR_ID", "contractorId is required", 400);
        return;
      }

      if (!payPeriodStart || !isValidDate(payPeriodStart)) {
        sendError(res, "INVALID_PAY_PERIOD_START", "payPeriodStart must be a valid date", 400);
        return;
      }

      if (!payPeriodEnd || !isValidDate(payPeriodEnd)) {
        sendError(res, "INVALID_PAY_PERIOD_END", "payPeriodEnd must be a valid date", 400);
        return;
      }

      const startDate = parseDate(payPeriodStart);
      const endDate = parseDate(payPeriodEnd);
      if (endDate < startDate) {
        sendError(res, "INVALID_PAY_PERIOD_RANGE", "payPeriodEnd must be on or after payPeriodStart", 400);
        return;
      }

      if (!Array.isArray(entries) || entries.length === 0) {
        sendError(res, "INVALID_ENTRIES", "entries must contain at least one entry", 400);
        return;
      }

      const normalizedEntries: TimesheetEntry[] = [];
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") {
          sendError(res, "INVALID_ENTRY", "Each entry must be an object", 400);
          return;
        }

        const entryDate = String(entry.date ?? "").trim();
        const hours = Number(entry.hours);
        const projectCode = String(entry.projectCode ?? "").trim();

        if (!entryDate || !isValidDate(entryDate)) {
          sendError(res, "INVALID_ENTRY_DATE", "Each entry date must be a valid date", 400);
          return;
        }

        if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
          sendError(res, "INVALID_HOURS", "Each entry hours must be a positive number up to 24", 400);
          return;
        }

        if (!projectCode) {
          sendError(res, "INVALID_PROJECT_CODE", "projectCode is required", 400);
          return;
        }

        if (!isWithinPeriod(entryDate, payPeriodStart, payPeriodEnd)) {
          sendError(res, "OUT_OF_PERIOD_ENTRY", "Each entry must fall within the pay period", 400);
          return;
        }

        normalizedEntries.push({
          date: entryDate,
          hours,
          projectCode,
        });
      }

      const duplicate = timesheets.some(
        (submission) => submission.contractorId === contractorId && submission.payPeriodStart === payPeriodStart && submission.payPeriodEnd === payPeriodEnd,
      );
      if (duplicate) {
        sendError(res, "DUPLICATE_SUBMISSION", "A timesheet for this contractor and pay period already exists", 409);
        return;
      }

      const submission: TimesheetSubmission = {
        id: `ts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        contractorId,
        payPeriodStart,
        payPeriodEnd,
        entries: normalizedEntries,
        createdAt: new Date().toISOString(),
      };

      timesheets.push(submission);

      return res.status(201).json({ success: true, data: submission });
    } catch (error) {
      return next(error);
    }
  },
);

export function __getTimesheets(): TimesheetSubmission[] {
  return timesheets.map((submission) => ({ ...submission, entries: submission.entries.map((entry) => ({ ...entry })) }));
}

export function __resetTimesheets(): void {
  timesheets.length = 0;
}

export default router;
