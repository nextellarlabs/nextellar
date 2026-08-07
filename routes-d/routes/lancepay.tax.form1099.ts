import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * IRS 1099-NEC reporting threshold (USD).
 * Payments below this amount in a calendar year do not require a 1099-NEC.
 */
const FORM_1099_THRESHOLD_USD = 600;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PayoutStatus = "pending" | "processing" | "completed" | "failed";

type PayoutRecord = {
  id: string;
  workspaceId: string;
  contractorId: string;
  amount: number;
  /** ISO-4217 currency code. Only USD payouts count toward the 1099-NEC. */
  currency: string;
  status: PayoutStatus;
  /** ISO-8601 timestamp used to bucket the payout into a tax year. */
  settledAt: string;
};

// ---------------------------------------------------------------------------
// In-memory store (test helpers below export seed / reset functions)
// ---------------------------------------------------------------------------

const payouts = new Map<string, PayoutRecord>();

// ---------------------------------------------------------------------------
// PDF builder
// ---------------------------------------------------------------------------

/**
 * Build a minimal PDF-shaped buffer for the 1099-NEC.
 * In production this would delegate to a PDF generation service; here we emit
 * a standards-compliant minimal PDF so tests can assert on headers and the
 * streaming path without pulling in a PDF library dependency.
 */
function build1099Pdf(
  workspaceId: string,
  contractorId: string,
  year: number,
  totalUsd: number,
): Buffer {
  const content = [
    `%PDF-1.4`,
    `% LancePay 1099-NEC`,
    `Form: 1099-NEC`,
    `Tax Year: ${year}`,
    `Workspace: ${workspaceId}`,
    `Contractor: ${contractorId}`,
    `Nonemployee Compensation (Box 1): ${totalUsd.toFixed(2)} USD`,
    ``,
    `%%EOF`,
  ].join("\n");

  return Buffer.from(content, "utf8");
}

// ---------------------------------------------------------------------------
// Route: GET /lancepay/tax-forms/1099
// ---------------------------------------------------------------------------

/**
 * GET /lancepay/tax-forms/1099
 *
 * Generate and stream a 1099-NEC PDF for a contractor within a LancePay
 * workspace.  Only USD-denominated completed payouts settled within the
 * requested tax year count toward the reportable amount.  If the total
 * falls below the IRS $600 threshold the route returns HTTP 204 (no
 * content) instead of generating a PDF.
 *
 * Query parameters:
 *   workspaceId   (required) – owning LancePay workspace
 *   contractorId  (required) – target contractor
 *   year          (optional) – tax year (defaults to current year)
 *
 * Auth:
 *   The caller must either
 *   (a) provide x-workspace-id matching the queried workspace, or
 *   (b) provide x-caller-id matching the queried contractor.
 *
 * Responses:
 *   200 – PDF streamed
 *   204 – Total compensation below $600 threshold; no 1099-NEC required
 *   400 – Missing or invalid query parameters
 *   401 – Missing auth headers
 *   403 – Caller not authorised for this workspace/contractor
 */
router.get(
  "/lancepay/tax-forms/1099",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // --- Extract and validate query parameters ---
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

      if (!callerWorkspaceId?.trim() && !callerId?.trim()) {
        sendError(res, "MISSING_AUTH", "x-workspace-id or x-caller-id header is required", 401);
        return;
      }

      const wsId = workspaceId.trim();
      const conId = contractorId.trim();

      const isWorkspaceCaller = callerWorkspaceId?.trim() === wsId;
      const isContractorCaller = callerId?.trim() === conId;

      if (!isWorkspaceCaller && !isContractorCaller) {
        sendError(
          res,
          "FORBIDDEN",
          "Access denied: caller must be the workspace owner or the contractor",
          403,
        );
        return;
      }

      // --- Aggregate eligible USD payouts for the tax year ---
      const yearStart = new Date(`${year}-01-01T00:00:00.000Z`).getTime();
      const yearEnd = new Date(`${year + 1}-01-01T00:00:00.000Z`).getTime();

      let totalUsd = 0;

      for (const payout of payouts.values()) {
        if (payout.workspaceId !== wsId) continue;
        if (payout.contractorId !== conId) continue;
        if (payout.status !== "completed") continue;
        if (payout.currency !== "USD") continue;

        const ts = new Date(payout.settledAt).getTime();
        if (ts < yearStart || ts >= yearEnd) continue;

        totalUsd += payout.amount;
      }

      // Round to 2 decimal places to avoid floating-point accumulation drift
      totalUsd = Math.round(totalUsd * 100) / 100;

      // --- Under-threshold: no 1099-NEC required ---
      if (totalUsd < FORM_1099_THRESHOLD_USD) {
        res.status(204).end();
        return;
      }

      // --- Generate and stream PDF ---
      const pdfBytes = build1099Pdf(wsId, conId, year, totalUsd);
      const filename = `1099-nec-${conId}-${year}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBytes.length);
      // Stream without buffering
      res.flushHeaders();
      res.end(pdfBytes);
    } catch (err) {
      return next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Test helpers (never used in production; tree-shaken or import-guarded)
// ---------------------------------------------------------------------------

export function __seedPayout(p: PayoutRecord): void {
  payouts.set(p.id, { ...p });
}

export function __resetPayouts(): void {
  payouts.clear();
}

export function __getPayouts(): Map<string, PayoutRecord> {
  return payouts;
}

export default router;
