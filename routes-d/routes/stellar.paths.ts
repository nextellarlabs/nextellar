import { Router, Request, Response, NextFunction } from "express";

const HORIZON_BASE =
  process.env.NEXTELLAR_HORIZON_URL?.trim() || "https://horizon.stellar.org";

const DEFAULT_PATHS_TTL_MS = Number(
  process.env.NEXTELLAR_PATHS_CACHE_TTL_MS ?? 10_000,
);

export interface PathRecord {
  source_asset_type: string;
  source_asset_code?: string;
  source_asset_issuer?: string;
  source_amount: string;
  destination_asset_type: string;
  destination_asset_code?: string;
  destination_asset_issuer?: string;
  destination_amount: string;
  path: {
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  }[];
}

export type PathsFetcher = (
  flow: "strict-receive" | "strict-send",
  params: URLSearchParams,
) => Promise<PathRecord[]>;

export interface PathsRouterOptions {
  fetcher?: PathsFetcher;
  ttlMs?: number;
}

export interface CachedPaths {
  flow: "strict-receive" | "strict-send";
  serializedQuery: string;
  records: PathRecord[];
  fetchedAt: number;
  expiresAt: number;
}

export class PathsCache {
  private readonly entries = new Map<string, CachedPaths>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs: number = DEFAULT_PATHS_TTL_MS, now: () => number = () => Date.now()) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  async get(
    flow: "strict-receive" | "strict-send",
    params: URLSearchParams,
    fetcher: PathsFetcher,
    options: { forceRefresh?: boolean } = {},
  ): Promise<{ value: CachedPaths; fromCache: boolean }> {
    const sortedParams = Array.from(params.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const serializedQuery = `${flow}?${new URLSearchParams(sortedParams).toString()}`;

    if (!options.forceRefresh) {
      const cached = this.entries.get(serializedQuery);
      if (cached && cached.expiresAt > this.now()) {
        return { value: cached, fromCache: true };
      }
    }

    const records = await fetcher(flow, params);
    const fetchedAt = this.now();
    const entry: CachedPaths = {
      flow,
      serializedQuery,
      records,
      fetchedAt,
      expiresAt: fetchedAt + this.ttlMs,
    };
    this.entries.set(serializedQuery, entry);
    return { value: entry, fromCache: false };
  }

  invalidate(flow: "strict-receive" | "strict-send", params: URLSearchParams): boolean {
    const sortedParams = Array.from(params.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const serializedQuery = `${flow}?${new URLSearchParams(sortedParams).toString()}`;
    return this.entries.delete(serializedQuery);
  }

  clear(): void {
    this.entries.clear();
  }
}

export const pathsCache = new PathsCache();

const defaultFetcher: PathsFetcher = async (flow, params) => {
  const endpoint = flow === "strict-receive" ? "strict-receive" : "strict-send";
  const url = `${HORIZON_BASE.replace(/\/$/, "")}/paths/${endpoint}?${params.toString()}`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`horizon_paths_lookup_failed_${response.status}`);
  }
  const payload = (await response.json()) as {
    _embedded?: {
      records?: PathRecord[];
    };
  };
  return payload._embedded?.records ?? [];
};

function formatAsset(type?: string, code?: string, issuer?: string): string {
  if (!type || type === "native") return "native";
  return `${code || ""}:${issuer || ""}`;
}

const getQueryParam = (req: Request, camel: string, snake: string): string | undefined => {
  const val = req.query[camel] ?? req.query[snake];
  return typeof val === "string" ? val.trim() : undefined;
};

export function createStellarPathsRouter(options: PathsRouterOptions = {}): Router {
  const router = Router();
  const fetcher = options.fetcher ?? defaultFetcher;
  const customCache = options.ttlMs !== undefined ? new PathsCache(options.ttlMs) : pathsCache;

  // Strict Receive Flow
  router.get(
    "/stellar/paths/strict-receive",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const destination_amount = getQueryParam(req, "destinationAmount", "destination_amount");
        const destination_asset_type = getQueryParam(req, "destinationAssetType", "destination_asset_type");
        const destination_asset_code = getQueryParam(req, "destinationAssetCode", "destination_asset_code");
        const destination_asset_issuer = getQueryParam(req, "destinationAssetIssuer", "destination_asset_issuer");
        const source_assets = getQueryParam(req, "sourceAssets", "source_assets");
        const source_account = getQueryParam(req, "sourceAccount", "source_account");
        const destination_account = getQueryParam(req, "destinationAccount", "destination_account");

        if (!destination_amount || parseFloat(destination_amount) <= 0) {
          return res.status(400).json({ error: "missing_or_invalid_destination_amount" });
        }
        if (!destination_asset_type) {
          return res.status(400).json({ error: "missing_destination_asset_type" });
        }
        if (destination_asset_type !== "native" && (!destination_asset_code || !destination_asset_issuer)) {
          return res.status(400).json({ error: "missing_destination_asset_details" });
        }
        if (!source_assets && !source_account) {
          return res.status(400).json({ error: "missing_source_assets_or_source_account" });
        }

        const params = new URLSearchParams();
        params.set("destination_amount", destination_amount);
        params.set("destination_asset_type", destination_asset_type);
        if (destination_asset_type !== "native") {
          params.set("destination_asset_code", destination_asset_code!);
          params.set("destination_asset_issuer", destination_asset_issuer!);
        }
        if (source_assets) {
          params.set("source_assets", source_assets);
        }
        if (source_account) {
          params.set("source_account", source_account);
        }
        if (destination_account) {
          params.set("destination_account", destination_account);
        }

        const forceRefresh =
          typeof req.query.refresh === "string" &&
          ["1", "true", "yes"].includes(req.query.refresh.toLowerCase());

        const { value, fromCache } = await customCache.get(
          "strict-receive",
          params,
          fetcher,
          { forceRefresh },
        );

        // Rank candidates: lowest source_amount (cost) first
        const sortedRecords = [...value.records].sort((a, b) => {
          const aVal = parseFloat(a.source_amount) || 0;
          const bVal = parseFloat(b.source_amount) || 0;
          return aVal - bVal;
        });

        const mappedPaths = sortedRecords.map((r) => ({
          sourceAsset: formatAsset(r.source_asset_type, r.source_asset_code, r.source_asset_issuer),
          sourceAmount: r.source_amount,
          destinationAsset: formatAsset(r.destination_asset_type, r.destination_asset_code, r.destination_asset_issuer),
          destinationAmount: r.destination_amount,
          path: r.path.map((p) => ({
            assetType: p.asset_type,
            assetCode: p.asset_code,
            assetIssuer: p.asset_issuer,
          })),
          estimatedCost: r.source_amount,
          estimatedReceive: r.destination_amount,
        }));

        return res.status(200).json({
          success: true,
          data: {
            flow: "strict-receive",
            paths: mappedPaths,
            raw: sortedRecords,
            fetchedAt: value.fetchedAt,
            expiresAt: value.expiresAt,
            fromCache,
          },
        });
      } catch (err: any) {
        if (err.message?.startsWith("horizon_paths_lookup_failed_")) {
          const statusStr = err.message.split("_").pop();
          const status = parseInt(statusStr, 10) || 502;
          return res.status(status).json({
            success: false,
            error: "horizon_paths_lookup_failed",
            details: err.message,
          });
        }
        return next(err);
      }
    },
  );

  // Strict Send Flow
  router.get(
    "/stellar/paths/strict-send",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const source_amount = getQueryParam(req, "sourceAmount", "source_amount");
        const source_asset_type = getQueryParam(req, "sourceAssetType", "source_asset_type");
        const source_asset_code = getQueryParam(req, "sourceAssetCode", "source_asset_code");
        const source_asset_issuer = getQueryParam(req, "sourceAssetIssuer", "source_asset_issuer");
        const destination_assets = getQueryParam(req, "destinationAssets", "destination_assets");
        const destination_account = getQueryParam(req, "destinationAccount", "destination_account");
        const source_account = getQueryParam(req, "sourceAccount", "source_account");

        if (!source_amount || parseFloat(source_amount) <= 0) {
          return res.status(400).json({ error: "missing_or_invalid_source_amount" });
        }
        if (!source_asset_type) {
          return res.status(400).json({ error: "missing_source_asset_type" });
        }
        if (source_asset_type !== "native" && (!source_asset_code || !source_asset_issuer)) {
          return res.status(400).json({ error: "missing_source_asset_details" });
        }
        if (!destination_assets && !destination_account) {
          return res.status(400).json({ error: "missing_destination_assets_or_destination_account" });
        }

        const params = new URLSearchParams();
        params.set("source_amount", source_amount);
        params.set("source_asset_type", source_asset_type);
        if (source_asset_type !== "native") {
          params.set("source_asset_code", source_asset_code!);
          params.set("source_asset_issuer", source_asset_issuer!);
        }
        if (destination_assets) {
          params.set("destination_assets", destination_assets);
        }
        if (destination_account) {
          params.set("destination_account", destination_account);
        }
        if (source_account) {
          params.set("source_account", source_account);
        }

        const forceRefresh =
          typeof req.query.refresh === "string" &&
          ["1", "true", "yes"].includes(req.query.refresh.toLowerCase());

        const { value, fromCache } = await customCache.get(
          "strict-send",
          params,
          fetcher,
          { forceRefresh },
        );

        // Rank candidates: highest destination_amount (payout) first
        const sortedRecords = [...value.records].sort((a, b) => {
          const aVal = parseFloat(a.destination_amount) || 0;
          const bVal = parseFloat(b.destination_amount) || 0;
          return bVal - aVal;
        });

        const mappedPaths = sortedRecords.map((r) => ({
          sourceAsset: formatAsset(r.source_asset_type, r.source_asset_code, r.source_asset_issuer),
          sourceAmount: r.source_amount,
          destinationAsset: formatAsset(r.destination_asset_type, r.destination_asset_code, r.destination_asset_issuer),
          destinationAmount: r.destination_amount,
          path: r.path.map((p) => ({
            assetType: p.asset_type,
            assetCode: p.asset_code,
            assetIssuer: p.asset_issuer,
          })),
          estimatedCost: r.source_amount,
          estimatedReceive: r.destination_amount,
        }));

        return res.status(200).json({
          success: true,
          data: {
            flow: "strict-send",
            paths: mappedPaths,
            raw: sortedRecords,
            fetchedAt: value.fetchedAt,
            expiresAt: value.expiresAt,
            fromCache,
          },
        });
      } catch (err: any) {
        if (err.message?.startsWith("horizon_paths_lookup_failed_")) {
          const statusStr = err.message.split("_").pop();
          const status = parseInt(statusStr, 10) || 502;
          return res.status(status).json({
            success: false,
            error: "horizon_paths_lookup_failed",
            details: err.message,
          });
        }
        return next(err);
      }
    },
  );

  return router;
}

export default createStellarPathsRouter();
