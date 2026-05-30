// Tests for the Horizon health check route (#331). Covers healthy /
// stale / unreachable for both the primary-only and primary+fallback
// configurations.

import express, { type Express } from "express";
import request from "supertest";
import {
  classify,
  createHorizonHealthRouter,
  type HorizonFetcher,
  type HorizonProbeResult,
} from "../routes/health.horizon.js";

interface FakeResponse {
  body: unknown;
  status?: number;
  ok?: boolean;
}

function makeFetcher(responses: Record<string, FakeResponse | Error>): HorizonFetcher {
  return async (url) => {
    const key = Object.keys(responses).find((k) => url.startsWith(k));
    if (!key) throw new Error(`unexpected url ${url}`);
    const r = responses[key]!;
    if (r instanceof Error) throw r;
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
    };
  };
}

function ledgerBody(closedAt: string, sequence = 12345) {
  return { _embedded: { records: [{ sequence, closed_at: closedAt }] } };
}

const NOW = Date.parse("2026-05-30T12:00:00Z");

function buildApp(opts: Parameters<typeof createHorizonHealthRouter>[0]): Express {
  const app = express();
  app.use("/health", createHorizonHealthRouter(opts));
  return app;
}

describe("classify()", () => {
  const fresh: HorizonProbeResult = { url: "p", reachable: true, ageMs: 1000 };
  const stale: HorizonProbeResult = { url: "p", reachable: true, ageMs: 999_999 };
  const unreachable: HorizonProbeResult = { url: "p", reachable: false, error: "x" };

  it("returns healthy when the primary is fresh", () => {
    expect(classify(fresh, undefined, 30_000)).toBe("healthy");
  });
  it("returns healthy when the fallback is fresh and the primary is stale", () => {
    expect(classify(stale, fresh, 30_000)).toBe("healthy");
  });
  it("returns stale when reachable but outside the window on every probe", () => {
    expect(classify(stale, undefined, 30_000)).toBe("stale");
  });
  it("returns unreachable when no probe is reachable", () => {
    expect(classify(unreachable, undefined, 30_000)).toBe("unreachable");
    expect(classify(unreachable, { ...unreachable }, 30_000)).toBe("unreachable");
  });
});

describe("GET /health/horizon", () => {
  const PRIMARY = "https://horizon.primary.test";
  const FALLBACK = "https://horizon.fallback.test";
  const freshIso = new Date(NOW - 1_000).toISOString();
  const staleIso = new Date(NOW - 600_000).toISOString();

  it("returns 200 + healthy when the primary is fresh", async () => {
    const fetcher = makeFetcher({ [PRIMARY]: { body: ledgerBody(freshIso) } });
    const app = buildApp({ primaryUrl: PRIMARY, fetcher, now: () => NOW });
    const res = await request(app).get("/health/horizon");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "healthy",
      primary: { reachable: true, latestLedger: 12345 },
    });
    expect(res.body.primary.ageMs).toBeLessThan(30_000);
  });

  it("returns 503 + stale when the primary is reachable but old", async () => {
    const fetcher = makeFetcher({ [PRIMARY]: { body: ledgerBody(staleIso) } });
    const app = buildApp({ primaryUrl: PRIMARY, fetcher, now: () => NOW });
    const res = await request(app).get("/health/horizon");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("stale");
  });

  it("returns 503 + unreachable when the primary throws", async () => {
    const fetcher = makeFetcher({ [PRIMARY]: new Error("ENOTFOUND") });
    const app = buildApp({ primaryUrl: PRIMARY, fetcher, now: () => NOW });
    const res = await request(app).get("/health/horizon");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unreachable");
    expect(res.body.primary.reachable).toBe(false);
    expect(res.body.primary.error).toMatch(/ENOTFOUND/);
  });

  it("probes the fallback separately when configured, healthy via fallback", async () => {
    const fetcher = makeFetcher({
      [PRIMARY]: { body: ledgerBody(staleIso) },
      [FALLBACK]: { body: ledgerBody(freshIso) },
    });
    const app = buildApp({
      primaryUrl: PRIMARY,
      fallbackUrl: FALLBACK,
      fetcher,
      now: () => NOW,
    });
    const res = await request(app).get("/health/horizon");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(res.body.primary.reachable).toBe(true);
    expect(res.body.fallback.reachable).toBe(true);
  });

  it("returns unreachable when both probes fail", async () => {
    const fetcher = makeFetcher({
      [PRIMARY]: new Error("EAI_AGAIN"),
      [FALLBACK]: { ok: false, status: 502, body: {} },
    });
    const app = buildApp({
      primaryUrl: PRIMARY,
      fallbackUrl: FALLBACK,
      fetcher,
      now: () => NOW,
    });
    const res = await request(app).get("/health/horizon");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unreachable");
    expect(res.body.fallback.error).toMatch(/HTTP 502/);
  });

  it("reports an error when the response has no ledger records", async () => {
    const fetcher = makeFetcher({ [PRIMARY]: { body: { _embedded: { records: [] } } } });
    const app = buildApp({ primaryUrl: PRIMARY, fetcher, now: () => NOW });
    const res = await request(app).get("/health/horizon");
    expect(res.status).toBe(503);
    expect(res.body.primary.reachable).toBe(false);
    expect(res.body.primary.error).toMatch(/no ledger records/);
  });
});
