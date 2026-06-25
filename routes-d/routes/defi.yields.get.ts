import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type YieldStrategy = {
  id: string;
  name: string;
  protocol: string;
  asset: string;
  grossApy: string;
  feeRate: string;
  netApy: string;
};

const DEFAULT_STRATEGIES: YieldStrategy[] = [
  { id: "phoenix-btc-xlm", name: "Phoenix BTC/XLM", protocol: "Phoenix", asset: "BTC", grossApy: "12.00", feeRate: "0.50", netApy: "11.50" },
  { id: "aqua-usdc", name: "Aqua USDC Pool", protocol: "Aqua", asset: "USDC", grossApy: "8.50", feeRate: "0.30", netApy: "8.20" },
  { id: "aqua-xlm", name: "Aqua XLM Pool", protocol: "Aqua", asset: "XLM", grossApy: "5.20", feeRate: "0.30", netApy: "4.90" },
];

const CACHE_TTL_MS = 30_000;

let strategies: YieldStrategy[] = [...DEFAULT_STRATEGIES];
let cachedYields: YieldStrategy[] | null = null;
let cacheTimestamp = 0;
let fetchAvailable = true;

export function __resetYieldsCache(): void {
  cachedYields = null;
  cacheTimestamp = 0;
  fetchAvailable = true;
  strategies = [...DEFAULT_STRATEGIES];
}

export function __setStrategies(data: YieldStrategy[]): void {
  strategies = data;
}

export function __seedYieldsCache(data: YieldStrategy[]): void {
  cachedYields = [...data];
  cacheTimestamp = 0;
}

export function __setFetchAvailable(v: boolean): void {
  fetchAvailable = v;
}

function fetchStrategies(): YieldStrategy[] {
  if (!fetchAvailable) {
    throw new Error("Yield data source unavailable");
  }
  return strategies.map((s) => ({ ...s }));
}

function rankByNetApy(list: YieldStrategy[]): YieldStrategy[] {
  return [...list].sort((a, b) => parseFloat(b.netApy) - parseFloat(a.netApy));
}

router.get("/defi/yields", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = Date.now();

    if (cachedYields && now - cacheTimestamp < CACHE_TTL_MS) {
      return res.status(200).json({
        success: true,
        data: { yields: rankByNetApy(cachedYields), fromCache: true },
      });
    }

    let fresh: YieldStrategy[];
    try {
      fresh = fetchStrategies();
    } catch {
      if (cachedYields) {
        return res.status(200).json({
          success: true,
          data: { yields: rankByNetApy(cachedYields), fromCache: true, stale: true },
        });
      }
      sendError(res, "YIELDS_UNAVAILABLE", "Yield data is currently unavailable", 503);
      return;
    }

    cachedYields = fresh;
    cacheTimestamp = now;

    return res.status(200).json({
      success: true,
      data: { yields: rankByNetApy(fresh), fromCache: false },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
