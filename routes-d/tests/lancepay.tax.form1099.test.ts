import express, { Request, Response, NextFunction } from "express";
import request from "supertest";
import router, {
  __seedPayout,
  __resetPayouts,
} from "../routes/lancepay.tax.form1099.js";

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
const CON_ID = "con-alice";

/** Completed USD payout worth $700 — above the $600 threshold. */
const ELIGIBLE_PAYOUT = {
  id: "pay-eligible-1",
  workspaceId: WS_ID,
  contractorId: CON_ID,
  amount: 700,
  currency: "USD",
  status: "completed" as const,
  settledAt: "2026-03-15T10:00:00Z",
};

/** Small USD payout — $100; alone it falls under threshold. */
const SMALL_PAYOUT = {
  id: "pay-small-1",
  workspaceId: WS_ID,
  contractorId: CON_ID,
  amount: 100,
  currency: "USD",
  status: "completed" as const,
  settledAt: "2026-04-01T08:00:00Z",
};

/** Pending payout — must NOT be counted. */
const PENDING_PAYOUT = {
  id: "pay-pending-1",
  workspaceId: WS_ID,
  contractorId: CON_ID,
  amount: 1000,
  currency: "USD",
  status: "pending" as const,
  settledAt: "2026-05-01T12:00:00Z",
};

/** Non-USD (EUR) payout — must NOT count toward 1099-NEC. */
const EUR_PAYOUT = {
  id: "pay-eur-1",
  workspaceId: WS_ID,
  contractorId: CON_ID,
  amount: 800,
  currency: "EUR",
  status: "completed" as const,
  settledAt: "2026-06-01T12:00:00Z",
};

/** Payout in a different year — must NOT be included. */
const PRIOR_YEAR_PAYOUT = {
  id: "pay-prior-year",
  workspaceId: WS_ID,
  contractorId: CON_ID,
  amount: 500,
  currency: "USD",
  status: "completed" as const,
  settledAt: "2025-12-31T23:59:59Z",
};

/** Payout belonging to a different workspace — must NOT be included. */
const OTHER_WS_PAYOUT = {
  id: "pay-other-ws",
  workspaceId: "ws-other",
  contractorId: CON_ID,
  amount: 800,
  currency: "USD",
  status: "completed" as const,
  settledAt: "2026-07-01T12:00:00Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /lancepay/tax-forms/1099", () => {
  const app = buildApp();

  beforeEach(() => {
    __resetPayouts();
  });

  // -------------------------------------------------------------------------
  // Happy path: eligible amount — streams PDF
  // -------------------------------------------------------------------------

  it("streams a PDF when total USD compensation is at or above $600", async () => {
    __seedPayout(ELIGIBLE_PAYOUT);

    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.headers["content-disposition"]).toContain(`1099-nec-${CON_ID}-2026.pdf`);
  });

  it("PDF body contains form label, contractor id, year, and compensation amount", async () => {
    __seedPayout(ELIGIBLE_PAYOUT);

    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks).toString("utf8")));
      });

    const body = res.body as string;
    expect(body).toContain("1099-NEC");
    expect(body).toContain(CON_ID);
    expect(body).toContain("2026");
    expect(body).toContain("700.00");
  });

  it("aggregates multiple completed USD payouts correctly", async () => {
    __seedPayout({ ...ELIGIBLE_PAYOUT, amount: 400 });
    __seedPayout({ ...SMALL_PAYOUT, id: "pay-small-2", amount: 300 }); // total = 700

    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks).toString("utf8")));
      });

    expect(res.status).toBe(200);
    expect(res.body as string).toContain("700.00");
  });

  it("allows the contractor to fetch their own 1099 form", async () => {
    __seedPayout(ELIGIBLE_PAYOUT);

    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-caller-id", CON_ID);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
  });

  // -------------------------------------------------------------------------
  // Under-threshold: returns 204
  // -------------------------------------------------------------------------

  it("returns 204 when total USD compensation is below $600", async () => {
    __seedPayout(SMALL_PAYOUT); // $100

    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
  });

  it("returns 204 when there are no payouts for the year", async () => {
    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(204);
  });

  it("returns 204 exactly at $599.99 (just below threshold)", async () => {
    __seedPayout({
      id: "pay-just-below",
      workspaceId: WS_ID,
      contractorId: CON_ID,
      amount: 599.99,
      currency: "USD",
      status: "completed",
      settledAt: "2026-02-01T00:00:00Z",
    });

    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(204);
  });

  it("returns 200 exactly at $600.00 (at threshold boundary)", async () => {
    __seedPayout({
      id: "pay-at-threshold",
      workspaceId: WS_ID,
      contractorId: CON_ID,
      amount: 600,
      currency: "USD",
      status: "completed",
      settledAt: "2026-02-01T00:00:00Z",
    });

    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
  });

  // -------------------------------------------------------------------------
  // Exclusion rules
  // -------------------------------------------------------------------------

  it("excludes pending payouts from the aggregate", async () => {
    __seedPayout(PENDING_PAYOUT); // $1000 pending — below threshold after exclusion

    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(204);
  });

  it("excludes non-USD payouts from the 1099-NEC aggregate", async () => {
    __seedPayout(EUR_PAYOUT); // $800 EUR — excluded from 1099 threshold check

    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(204);
  });

  it("excludes payouts from a different tax year", async () => {
    __seedPayout(PRIOR_YEAR_PAYOUT); // 2025 payout

    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(204);
  });

  it("excludes payouts from other workspaces", async () => {
    __seedPayout(OTHER_WS_PAYOUT); // ws-other workspace

    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(204);
  });

  // -------------------------------------------------------------------------
  // Unauthorized caller
  // -------------------------------------------------------------------------

  it("returns 401 when no auth header is provided", async () => {
    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("MISSING_AUTH");
  });

  it("returns 403 when the caller is a different workspace", async () => {
    __seedPayout(ELIGIBLE_PAYOUT);

    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", "ws-attacker");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 when the caller is a different contractor", async () => {
    __seedPayout(ELIGIBLE_PAYOUT);

    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=2026`)
      .set("x-caller-id", "con-mallory");

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  // -------------------------------------------------------------------------
  // Validation errors
  // -------------------------------------------------------------------------

  it("returns 400 when workspaceId is missing", async () => {
    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?contractorId=${CON_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_WORKSPACE_ID");
  });

  it("returns 400 when contractorId is missing", async () => {
    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&year=2026`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_CONTRACTOR_ID");
  });

  it("returns 400 when year is invalid", async () => {
    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}&year=abc`)
      .set("x-workspace-id", WS_ID);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_YEAR");
  });

  it("defaults to the current year when year is omitted", async () => {
    __seedPayout(ELIGIBLE_PAYOUT); // settledAt is in 2026

    const res = await request(app)
      .get(`/lancepay/tax-forms/1099?workspaceId=${WS_ID}&contractorId=${CON_ID}`)
      .set("x-workspace-id", WS_ID);

    // Current year per system context is 2026; eligible payout should be included
    expect(res.status).toBe(200);
  });
});
