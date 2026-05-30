import { Router, type NextFunction, type Request, type Response } from "express";

export interface SorobanRpcLike {
  getLatestLedger(): Promise<{ sequence: number }>;
}

export interface SorobanHealthResult {
  status: "healthy" | "stalled" | "unreachable";
  latestLedger?: number;
  previousLedger?: number;
  latencyMs: number;
  error?: string;
}

export interface SorobanHealthRouterOptions {
  rpc: SorobanRpcLike;
  advanceWindowMs?: number;
  probeDelayMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function probe(opts: SorobanHealthRouterOptions): Promise<SorobanHealthResult> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const delay = opts.probeDelayMs ?? 250;
  const started = now();
  try {
    const first = await opts.rpc.getLatestLedger();
    await sleep(delay);
    const second = await opts.rpc.getLatestLedger();
    const latencyMs = now() - started;
    if (second.sequence > first.sequence) {
      return { status: "healthy", latestLedger: second.sequence, previousLedger: first.sequence, latencyMs };
    }
    return { status: "stalled", latestLedger: second.sequence, previousLedger: first.sequence, latencyMs };
  } catch (err) {
    return {
      status: "unreachable",
      latencyMs: now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function createSorobanHealthRouter(opts: SorobanHealthRouterOptions): Router {
  const router = Router();
  const advanceWindowMs = opts.advanceWindowMs ?? 5_000;

  router.get("/soroban", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await probe(opts);
      const healthy = result.status === "healthy" && result.latencyMs <= advanceWindowMs;
      const http = healthy ? 200 : 503;
      return res.status(http).json(result);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
