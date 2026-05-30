import { Router, type NextFunction, type Request, type Response } from "express";
import { isInternalRequest } from "../lib/internalIp.js";
import { recordRequest, renderMetrics } from "../lib/metrics.js";

const router = Router();

router.get("/metrics", (req: Request, res: Response, next: NextFunction) => {
  const startedAt = Date.now();
  try {
    if (!isInternalRequest(req)) {
      return res.status(403).json({ error: "metrics are restricted to internal networks" });
    }
    const body = renderMetrics();
    recordRequest("/metrics", req.method, 200, Date.now() - startedAt);
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return res.status(200).send(body);
  } catch (err) {
    recordRequest("/metrics", req.method, 500, Date.now() - startedAt);
    return next(err);
  }
});

export default router;
