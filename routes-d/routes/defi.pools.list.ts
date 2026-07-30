import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type Asset = {
  code: string;
  issuer: string;
  amount: string;
};

type PoolSummary = {
  id: string;
  assetA: Asset;
  assetB: Asset;
  totalShares: string;
  apyEstimate: string;
};

const DEFAULT_POOLS: PoolSummary[] = [
  {
    id: "pool-usdc-xlm",
    assetA: { code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", amount: "1000000.00" },
    assetB: { code: "XLM", issuer: "native", amount: "50000000.00" },
    totalShares: "7071067.81",
    apyEstimate: "5.04",
  },
  {
    id: "pool-btc-xlm",
    assetA: { code: "BTC", issuer: "GDPJALI4AZKUU2W426U5WKMAT6CN3AJRPIIRYR2YM54TL2GDWO5O2MZM", amount: "10.00" },
    assetB: { code: "XLM", issuer: "native", amount: "2000000.00" },
    totalShares: "4472.13",
    apyEstimate: "7.20",
  },
  {
    id: "pool-usdt-xlm",
    assetA: { code: "USDT", issuer: "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53NMYVOZ3A7EKV68", amount: "500000.00" },
    assetB: { code: "XLM", issuer: "native", amount: "25000000.00" },
    totalShares: "3535533.90",
    apyEstimate: "4.80",
  },
];

const CACHE_TTL_MS = 15_000;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

let poolsStore: PoolSummary[] = [...DEFAULT_POOLS];
let cachedPools: PoolSummary[] | null = null;
let cacheTimestamp = 0;

export function __resetPoolsListCache(): void {
  cachedPools = null;
  cacheTimestamp = 0;
  poolsStore = [...DEFAULT_POOLS];
}

export function __seedPoolsList(pools: PoolSummary[]): void {
  poolsStore = pools;
  cachedPools = null;
  cacheTimestamp = 0;
}

router.get("/defi/pools", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = req.query.page !== undefined ? parseInt(req.query.page as string, 10) : DEFAULT_PAGE;
    const limit = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : DEFAULT_LIMIT;

    if (isNaN(page) || page < 1 || isNaN(limit) || limit < 1 || limit > MAX_LIMIT) {
      sendError(res, "INVALID_PAGINATION", "page must be >= 1 and limit must be between 1 and 100", 400);
      return;
    }

    const assetFilter = typeof req.query.asset === "string" ? req.query.asset.toUpperCase() : null;

    const now = Date.now();
    let allPools: PoolSummary[];
    let fromCache: boolean;

    if (cachedPools && now - cacheTimestamp < CACHE_TTL_MS) {
      allPools = cachedPools;
      fromCache = true;
    } else {
      allPools = poolsStore.map((p) => ({ ...p }));
      cachedPools = allPools;
      cacheTimestamp = now;
      fromCache = false;
    }

    const filtered = assetFilter
      ? allPools.filter(
          (p) =>
            p.assetA.code.toUpperCase() === assetFilter ||
            p.assetB.code.toUpperCase() === assetFilter,
        )
      : allPools;

    const total = filtered.length;
    const offset = (page - 1) * limit;
    const paginated = filtered.slice(offset, offset + limit);

    return res.status(200).json({
      success: true,
      data: { pools: paginated, fromCache },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
