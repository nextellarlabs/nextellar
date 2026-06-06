// GET /status — overall aggregate health endpoint (#332).
//
// Fans out to the per-dependency checks already on `main`
// (`health.horizon.ts`, `health.soroban.ts`, plus any caller-supplied
// extras) and returns a single summary. Each fan-out is bounded by a
// timeout so a single slow dependency cannot wedge the response.

import { Router, type Request, type Response } from "express";

export type ComponentState = "healthy" | "degraded" | "unreachable";

export interface ComponentStatus {
  name: string;
  state: ComponentState;
  /** Latency of the fan-out probe (ms). */
  latencyMs: number;
  /** Free-form details surfaced from the underlying probe. */
  detail?: Record<string, unknown>;
  /** Reason when state !== "healthy". */
  error?: string;
}

export interface StatusResult {
  status: ComponentState;
  components: ComponentStatus[];
}

export interface StatusCheck {
  name: string;
  /** Probe function. Should resolve (not reject) and reflect failure
   *  via `state`. The router still defensively catches rejections. */
  check: () => Promise<Pick<ComponentStatus, "state" | "detail" | "error">>;
}

export interface StatusRouterOptions {
  checks: StatusCheck[];
  /** Per-check timeout (ms). Default 2000. */
  timeoutMs?: number;
  /** Clock for tests. */
  now?: () => number;
}

function rollUp(components: ComponentStatus[]): ComponentState {
  if (components.length === 0) return "healthy";
  if (components.every((c) => c.state === "healthy")) return "healthy";
  if (components.some((c) => c.state === "unreachable")) return "unreachable";
  return "degraded";
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`check timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createStatusRouter(opts: StatusRouterOptions): Router {
  const router = Router();
  const timeoutMs = opts.timeoutMs ?? 2000;
  const now = opts.now ?? Date.now;

  router.get("/", async (_req: Request, res: Response) => {
    const components: ComponentStatus[] = await Promise.all(
      opts.checks.map(async (c) => {
        const t0 = now();
        try {
          const result = await withTimeout(c.check(), timeoutMs);
          return {
            name: c.name,
            state: result.state,
            latencyMs: now() - t0,
            detail: result.detail,
            error: result.error,
          };
        } catch (err) {
          return {
            name: c.name,
            state: "unreachable" as ComponentState,
            latencyMs: now() - t0,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    const status = rollUp(components);
    const http = status === "healthy" ? 200 : 503;
    const body: StatusResult = { status, components };
    res.status(http).json(body);
  });

  return router;
}

export { rollUp as _rollUp };
