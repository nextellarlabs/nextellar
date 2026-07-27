import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PayoutStatus = "pending" | "processing" | "completed" | "failed";

type PayoutRecord = {
  id: string;
  workspaceId: string;
  contractorId: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  /** Tax withheld from this payout (in the payout's currency). */
  withholding?: number;
  /** Net amount after withholdings (in the payout's currency). */
  netAmount?: number;
  submittedAt: string;
};

type CurrencyConversion = {
  id: string;
  workspaceId: string;
  contractorId: string;
  fromCurrency: string;
  toCurrency: string;
  fromAmount: number;
  toAmount: number;
  rate: number;
  convertedAt: string;
};

type CurrencyBreakdown = {
  grossAmount: number;
  netAmount: number;
  withholding: number;
  count: number;
};

type YearSummaryResponse = {
  year: number;
  workspaceId: string;
  contractorId: string;
  summary: {
    totalGrossAmount: number;
    totalWithholdings: number;
    totalNetAmount: number;
    payoutCount: number;
    currencies: Record<string, CurrencyBreakdown>;
    currencyConversions: Array<{
      fromCurrency: string;
      toCurrency: string;
      fromAmount: number;
      toAmount: number;
      rate: number;
      date: string;
    }>;
  };
};

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

const payouts = new Map<string, PayoutRecord>();
const conversions = new Map<string, CurrencyConversion>();

// ---------------------------------------------------------------------------
// Route: GET /lancepay/tax-forms/year-summary
// ---------------------------------------------------------------------------

/**
 * GET /lancepay/tax-forms/year-summary
 *
 * Return an annual tax summary for a contractor within a LancePay workspace.
 * Aggregates payouts, withholdings, and currency conversions per year.
 *
 * Query parameters:
 *   workspaceId   (required) – owning LancePay workspace
 *   contractorId  (required) – target contractor
 *   year          (optional) – fiscal year (defaults to current year)
 *
 * Auth:
 *   The caller must either
 *   (a) provide x-workspace-id matching the queried workspace, or
 *   (b) provide x-caller-id matching the queried contractor.
 *
 * Responses:
 *   200 – Year summary returned
 *   400 – Missing or invalid query parameters
 *   401 – Missing auth headers
 *   403 – Caller not authorised for this workspace/contractor
 */
router.get(
  "/lancepay/tax-forms/year-summary",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // --- Extract query parameters ---
      const workspaceId = req.query.workspaceId as string | undefined;
      const contractorId = req.query.contractorId as string | undefined;
      const yearParam = req.query.year as string | undefined;

      if (!workspaceId || typeof workspaceId !== "string" || !workspaceId.trim()) {
        sendError(res, "MISSING_WORKSPACE_ID", "workspaceId query parameter is required", 400);
        return;
      }

      if (!contractorId || typeof contractorId !== "string" || !contractorId.trim()) {
        sendError(res, "MISSING_CONTRACTOR_ID", "contractorId query parameter is required", 400);
        return;
      }

      const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
      if (isNaN(year) || year < 1900 || year > 2100) {
        sendError(res, "INVALID_YEAR", "year must be a valid 4-digit year between 1900 and 2100", 400);
        return;
      }

      // --- Authorisation ---
      const callerWorkspaceId = req.headers["x-workspace-id"] as string | undefined;
      const callerId = req.headers["x-caller-id"] as string | undefined;

      // Missing auth must be checked before matching so we return 401, not 403
      if (!callerWorkspaceId?.trim() && !callerId?.trim()) {
        sendError(
          res,
          "MISSING_AUTH",
          "x-workspace-id or x-caller-id header is required",
          401,
        );
        return;
      }

      const isWorkspaceCaller = callerWorkspaceId?.trim() === workspaceId.trim();
      const isContractorCaller = callerId?.trim() === contractorId.trim();

      if (!isWorkspaceCaller && !isContractorCaller) {
        sendError(
          res,
          "FORBIDDEN",
          "Access denied: caller must be the workspace owner or the contractor",
          403,
        );
        return;
      }

      const wsId = workspaceId.trim();
      const conId = contractorId.trim();

      // --- Compute year boundaries ---
      const yearStart = new Date(`${year}-01-01T00:00:00.000Z`);
      const yearEnd = new Date(`${year + 1}-01-01T00:00:00.000Z`);

      // --- Aggregate payouts ---
      const yearPayouts = Array.from(payouts.values()).filter((p) => {
        if (p.workspaceId !== wsId) return false;
        if (p.contractorId !== conId) return false;
        if (p.status !== "completed") return false;
        const ts = new Date(p.submittedAt).getTime();
        return ts >= yearStart.getTime() && ts < yearEnd.getTime();
      });

      let totalGrossAmount = 0;
      let totalWithholdings = 0;
      let totalNetAmount = 0;
      const currencies: Record<string, CurrencyBreakdown> = {};

      for (const payout of yearPayouts) {
        const cur = payout.currency;
        const withholding = payout.withholding ?? 0;
        const net = payout.netAmount ?? (payout.amount - withholding);

        totalGrossAmount += payout.amount;
        totalWithholdings += withholding;
        totalNetAmount += net;

        if (!currencies[cur]) {
          currencies[cur] = { grossAmount: 0, netAmount: 0, withholding: 0, count: 0 };
        }
        currencies[cur].grossAmount += payout.amount;
        currencies[cur].netAmount += net;
        currencies[cur].withholding += withholding;
        currencies[cur].count += 1;
      }

      // --- Aggregate currency conversions ---
      const yearConversions = Array.from(conversions.values()).filter((c) => {
        if (c.workspaceId !== wsId) return false;
        if (c.contractorId !== conId) return false;
        const ts = new Date(c.convertedAt).getTime();
        return ts >= yearStart.getTime() && ts < yearEnd.getTime();
      });

      const conversionRecords = yearConversions.map((c) => ({
        fromCurrency: c.fromCurrency,
        toCurrency: c.toCurrency,
        fromAmount: c.fromAmount,
        toAmount: c.toAmount,
        rate: c.rate,
        date: c.convertedAt,
      }));

      // Round summary totals to 2 decimal places
      const round2 = (n: number): number => Math.round(n * 100) / 100;

      const response: YearSummaryResponse = {
        year,
        workspaceId: wsId,
        contractorId: conId,
        summary: {
          totalGrossAmount: round2(totalGrossAmount),
          totalWithholdings: round2(totalWithholdings),
          totalNetAmount: round2(totalNetAmount),
          payoutCount: yearPayouts.length,
          currencies: Object.fromEntries(
            Object.entries(currencies).map(([cur, breakdown]) => [
              cur,
              {
                grossAmount: round2(breakdown.grossAmount),
                netAmount: round2(breakdown.netAmount),
                withholding: round2(breakdown.withholding),
                count: breakdown.count,
              },
            ]),
          ),
          currencyConversions: conversionRecords,
        },
      };

      return res.status(200).json({ success: true, data: response });
    } catch (err) {
      return next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function __seedPayout(p: PayoutRecord): void {
  payouts.set(p.id, { ...p });
}

export function __seedConversion(c: CurrencyConversion): void {
  conversions.set(c.id, { ...c });
}

export function __resetData(): void {
  payouts.clear();
  conversions.clear();
}

export function __getPayouts(): Map<string, PayoutRecord> {
  return payouts;
}

export function __getConversions(): Map<string, CurrencyConversion> {
  return conversions;
}

export default router;
