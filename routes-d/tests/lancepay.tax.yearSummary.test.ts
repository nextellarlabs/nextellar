import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedPayout,
  __seedConversion,
  __resetData,
} from "../routes/lancepay.tax.yearSummary.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WS_ID = "ws-acmecorp";
const CON_ID = "con-jane-doe";

const USD_PAYOUT = {
  id: "pay-usd-1",
  workspaceId: WS_ID,
  contractorId: CON_ID,
  amount: 5000,
  currency: "USD",
  status: "completed" as const,
  withholding: 750,
  netAmount: 4250,
  submittedAt: "2026-03-15T10:00:00Z",
};

const EUR_PAYOUT = {
  id: "pay-eur-1",
  workspaceId: WS_ID,
  contractorId: CON_ID,
  amount: 3000,
  currency: "EUR",
  status: "completed" as const,
  withholding: 450,
  netAmount: 2550,
  submittedAt: "2026-06-20T14:30:00Z",
};

const USD_PAYOUT_2 = {
  id: "pay-usd-2",
  workspaceId: WS_ID,
  contractorId: CON_ID,
  amount: 2500,
  currency: "USD",
  status: "completed" as const,
  withholding: 375,
  netAmount: 2125,
  submittedAt: "2026-09-01T08:00:00Z",
};

const OTHER_WS_PAYOUT = {
  id: "pay-other-ws",
  workspaceId: "ws-other",
  contractorId: CON_ID,
  amount: 1000,
  currency: "USD",
  status: "completed" as const,
  submittedAt: "2026-04-01T12:00:00Z",
};

const PENDING_PAYOUT = {
  id: "pay-pending",
  workspaceId: WS_ID,
  contractorId: CON_ID,
  amount: 2000,
  currency: "USD",
  status: "pending" as const,
  submittedAt: "2026-11-01T12:00:00Z",
};

const DIFFERENT_YEAR_PAYOUT = {
  id: "pay-2025",
  workspaceId: WS_ID,
  contractorId: CON_ID,
  amount: 1000,
  currency: "USD",
  status: "completed" as const,
  submittedAt: "2025-12-31T23:59:59Z",
};

const EUR_CONVERSION = {
  id: "conv-eur-usd-1",
  workspaceId: WS_ID,
  contractorId: CON_ID,
  fromCurrency: "EUR",
  toCurrency: "USD",
  fromAmount: 3000,
  toAmount: 3255,
  rate: 1.085,
  convertedAt: "2026-06-20T15:00:00Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /lancepay/tax-forms/year-summary", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetData();
  });

  // --- Happy path: full year with multi-currency payouts ---

  it("returns aggregated year summary for a workspace caller", async () => {
    __seedPayout(USD_PAYOUT);
    __seedPayout(EUR_PAYOUT);
    __seedPayout(USD_PAYOUT_2);
    __seedConversion(EUR_CONVERSION);

    const res = await request(app)
      .get(`/lancepay/tax-forms/year-summary?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data.year).toBe(2026);
    expect(data.workspaceId).toBe(WS_ID);
    expect(data.contractorId).toBe(CON_ID);

    // Total aggregations
    expect(data.summary.totalGrossAmount).toBe(5000 + 3000 + 2500); // 10500
    expect(data.summary.totalWithholdings).toBe(750 + 450 + 375); // 1575
    expect(data.summary.totalNetAmount).toBe(4250 + 2550 + 2125); // 8925
    expect(data.summary.payoutCount).toBe(3);

    // Currency breakdowns
    expect(data.summary.currencies).toEqual({
      USD: {
        grossAmount: 7500,
        netAmount: 6375,
        withholding: 1125,
        count: 2,
      },
      EUR: {
        grossAmount: 3000,
        netAmount: 2550,
        withholding: 450,
        count: 1,
      },
    });

    // Currency conversions
    expect(data.summary.currencyConversions).toHaveLength(1);
    expect(data.summary.currencyConversions[0]).toEqual({
      fromCurrency: "EUR",
      toCurrency: "USD",
      fromAmount: 3000,
      toAmount: 3255,
      rate: 1.085,
      date: "2026-06-20T15:00:00Z",
    });
  });

  // --- Contractor caller (x-caller-id) ---

  it("allows the contractor to access their own summary", async () => {
    __seedPayout(USD_PAYOUT);

    const res = await request(app)
      .get(`/lancepay/tax-forms/year-summary?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-caller-id", CON_ID);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.payoutCount).toBe(1);
    expect(res.body.data.summary.totalGrossAmount).toBe(5000);
  });

  // --- Empty year (no payouts) ---

  it("returns empty summary when the year has no payouts", async () => {
    __seedPayout(USD_PAYOUT); // 2026

    const res = await request(app)
      .get(`/lancepay/tax-forms/year-summary?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2027`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.payoutCount).toBe(0);
    expect(res.body.data.summary.totalGrossAmount).toBe(0);
    expect(res.body.data.summary.totalWithholdings).toBe(0);
    expect(res.body.data.summary.totalNetAmount).toBe(0);
    expect(res.body.data.summary.currencies).toEqual({});
    expect(res.body.data.summary.currencyConversions).toEqual([]);
    expect(res.body.data.year).toBe(2027);
  });

  // --- Unauthorised caller ---

  it("returns 403 when the caller is not the workspace or contractor", async () => {
    __seedPayout(USD_PAYOUT);

    const res = await request(app)
      .get(`/lancepay/tax-forms/year-summary?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", "ws-evil-corp");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 401 when no auth header is provided", async () => {
    const res = await request(app)
      .get(`/lancepay/tax-forms/year-summary?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("MISSING_AUTH");
  });

  // --- Missing query parameters ---

  it("returns 400 when workspaceId is missing", async () => {
    const res = await request(app)
      .get(`/lancepay/tax-forms/year-summary?contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_WORKSPACE_ID");
  });

  it("returns 400 when contractorId is missing", async () => {
    const res = await request(app)
      .get(`/lancepay/tax-forms/year-summary?workspaceId=${WS_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_CONTRACTOR_ID");
  });

  it("returns 400 when year is invalid", async () => {
    const res = await request(app)
      .get(`/lancepay/tax-forms/year-summary?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=abcd`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_YEAR");
  });

  // --- Year defaults to current year ---

  it("defaults to the current year when year is omitted", async () => {
    __seedPayout(USD_PAYOUT); // 2026
    __seedPayout(DIFFERENT_YEAR_PAYOUT); // 2025

    const res = await request(app)
      .get(`/lancepay/tax-forms/year-summary?workspaceId=${WS_ID}&contractorId=${CON_ID}`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(200);
    // The current date for this test environment is 2026-07-25 per system info
    expect(res.body.data.year).toBe(2026);
    expect(res.body.data.summary.payoutCount).toBe(1);
    expect(res.body.data.summary.totalGrossAmount).toBe(5000);
  });

  // --- Only completed payouts are considered ---

  it("only includes completed payouts in the summary", async () => {
    __seedPayout(USD_PAYOUT);     // completed
    __seedPayout(PENDING_PAYOUT); // pending

    const res = await request(app)
      .get(`/lancepay/tax-forms/year-summary?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.payoutCount).toBe(1);
    expect(res.body.data.summary.totalGrossAmount).toBe(5000);
  });

  // --- Cross-workspace payouts are excluded ---

  it("excludes payouts from other workspaces", async () => {
    __seedPayout(USD_PAYOUT);       // WS_ID
    __seedPayout(OTHER_WS_PAYOUT);  // ws-other

    const res = await request(app)
      .get(`/lancepay/tax-forms/year-summary?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.payoutCount).toBe(1);
    expect(res.body.data.summary.totalGrossAmount).toBe(5000);
  });

  // --- Payouts without explicit withholdings/net use defaults ---

  it("handles payouts without withholding fields", async () => {
    __seedPayout({
      id: "pay-no-withhold",
      workspaceId: WS_ID,
      contractorId: CON_ID,
      amount: 1000,
      currency: "USD",
      status: "completed",
      submittedAt: "2026-05-01T12:00:00Z",
    });

    const res = await request(app)
      .get(`/lancepay/tax-forms/year-summary?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(200);
    expect(res.body.data.summary.totalGrossAmount).toBe(1000);
    expect(res.body.data.summary.totalWithholdings).toBe(0);
    expect(res.body.data.summary.totalNetAmount).toBe(1000);
  });
});
