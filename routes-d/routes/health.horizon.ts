// GET /health/horizon — reach the configured Horizon endpoint(s) and
// report freshness (#331). Probes the primary and fallback URLs
// separately so the response can show which is responding and how
// stale each one is.

import { Router, type Request, type Response } from "express";

export interface HorizonProbeResult {
  url: string;
  reachable: boolean;
  /** Latest ledger sequence reported by the endpoint, if reachable. */
  latestLedger?: number;
  /** Closed-at timestamp of that ledger (ISO string), if reachable. */
  closedAt?: string;
  /** Age of that ledger in milliseconds at the moment the probe ran. */
  ageMs?: number;
  /** Reason field populated when reachable is false. */
  error?: string;
}

export interface HorizonHealthResult {
  status: "healthy" | "stale" | "unreachable";
  primary: HorizonProbeResult;
  fallback?: HorizonProbeResult;
}

export type HorizonFetcher = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface HorizonHealthRouterOptions {
  primaryUrl: string;
  fallbackUrl?: string;
  /** Maximum acceptable age, ms. Default 30s. */
  freshnessWindowMs?: number;
  /** Per-probe timeout, ms. Default 5s. */
  timeoutMs?: number;
  /** Override fetch for tests; defaults to global `fetch`. */
  fetcher?: HorizonFetcher;
  /** Clock injection so tests can pin "now". */
  now?: () => number;
}

interface HorizonLedgerEmbedded {
  records?: Array<{
    sequence?: number;
    closed_at?: string;
  }>;
}

interface HorizonLedgersResponse {
  _embedded?: HorizonLedgerEmbedded;
}

const defaultFetcher: HorizonFetcher = async (url) => {
  const resp = await fetch(url);
  return {
    ok: resp.ok,
    status: resp.status,
    json: () => resp.json() as Promise<unknown>,
  };
};

async function probe(
  url: string,
  fetcher: HorizonFetcher,
  timeoutMs: number,
  now: () => number,
): Promise<HorizonProbeResult> {
  const target = `${url.replace(/\/+$/u, "")}/ledgers?order=desc&limit=1`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      fetcher(target),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    if (!result.ok) {
      return { url, reachable: false, error: `HTTP ${result.status}` };
    }
    const body = (await result.json()) as HorizonLedgersResponse;
    const record = body._embedded?.records?.[0];
    if (!record?.sequence || !record.closed_at) {
      return { url, reachable: false, error: "no ledger records in response" };
    }
    const closedAtMs = Date.parse(record.closed_at);
    if (Number.isNaN(closedAtMs)) {
      return { url, reachable: false, error: `invalid closed_at '${record.closed_at}'` };
    }
    const ageMs = Math.max(0, now() - closedAtMs);
    return {
      url,
      reachable: true,
      latestLedger: record.sequence,
      closedAt: record.closed_at,
      ageMs,
    };
  } catch (err) {
    return {
      url,
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function classify(
  primary: HorizonProbeResult,
  fallback: HorizonProbeResult | undefined,
  freshnessWindowMs: number,
): HorizonHealthResult["status"] {
  const fresh = (p?: HorizonProbeResult) =>
    p?.reachable && p.ageMs !== undefined && p.ageMs <= freshnessWindowMs;
  if (fresh(primary) || fresh(fallback)) return "healthy";
  if (primary.reachable || fallback?.reachable) return "stale";
  return "unreachable";
}

export function createHorizonHealthRouter(opts: HorizonHealthRouterOptions): Router {
  const router = Router();
  const freshnessWindow = opts.freshnessWindowMs ?? 30_000;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const fetcher = opts.fetcher ?? defaultFetcher;
  const now = opts.now ?? Date.now;

  router.get("/horizon", async (_req: Request, res: Response) => {
    const primary = await probe(opts.primaryUrl, fetcher, timeoutMs, now);
    const fallback = opts.fallbackUrl
      ? await probe(opts.fallbackUrl, fetcher, timeoutMs, now)
      : undefined;
    const status = classify(primary, fallback, freshnessWindow);
    const http = status === "healthy" ? 200 : status === "stale" ? 503 : 503;
    const body: HorizonHealthResult = fallback
      ? { status, primary, fallback }
      : { status, primary };
    res.status(http).json(body);
  });

  return router;
}
