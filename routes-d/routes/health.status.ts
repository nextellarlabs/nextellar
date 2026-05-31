import { Router, type Request, type Response } from "express";
import { getDbPool } from "../lib/db.js";

export interface StatusRouterOptions {
  pool?: ReturnType<typeof getDbPool>;
}

export function createStatusRouter(opts: StatusRouterOptions = {}): Router {
  const router = Router();
  const pool = opts.pool ?? getDbPool();

  router.get("/status", async (_req: Request, res: Response) => {
    const health = await pool.health();
    const metrics = pool.metrics();
    const http = health.ok ? 200 : 503;
    res.status(http).json({
      ok: health.ok,
      db: {
        ...health,
        pool: metrics,
      },
    });
  });

  return router;
}

export default createStatusRouter();
