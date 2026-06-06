import { Router, type Request, type Response } from "express";
import { SorobanIndexer, type SorobanIndexerOptions } from "../lib/sorobanIndexer.js";

export interface SorobanEventsRouterOptions extends SorobanIndexerOptions {
  indexer?: SorobanIndexer;
}

export function createSorobanEventsRouter(options: SorobanEventsRouterOptions): Router {
  const router = Router();
  const indexer = options.indexer ?? new SorobanIndexer(options);

  router.get("/events", async (_req: Request, res: Response) => {
    const req = _req;
    const contractId =
      typeof req.query.contractId === "string" ? req.query.contractId.trim() : undefined;
    const topic = typeof req.query.topic === "string" ? req.query.topic.trim() : undefined;
    const limitRaw = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 20;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor.trim() : undefined;

    const page = indexer.query({ contractId, topic, limit, cursor });
    res.status(200).json({
      ok: true,
      events: page.events,
      pagination: {
        limit,
        cursor: page.nextCursor,
        hasMore: page.hasMore,
      },
    });
  });

  router.post("/events/ingest", async (_req: Request, res: Response) => {
    const ingested = await indexer.ingestOnce();
    res.status(202).json({ ok: true, ingested });
  });

  return router;
}
