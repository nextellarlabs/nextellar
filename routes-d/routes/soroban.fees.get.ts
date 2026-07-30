import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type FeeStats = {
  baseFee: {
    min: string;
    max: string;
    mode: string;
    p10: string;
    p50: string;
    p99: string;
  };
  resourceFee: {
    min: string;
    max: string;
    mode: string;
    p10: string;
    p50: string;
    p99: string;
  };
  latestLedger: number;
  cachedAt: number;
};

const CACHE_TTL_MS = 10_000;

let cachedStats: FeeStats | null = null;
let cacheTimestamp = 0;
let rpcAvailable = true;

export function __resetFeeCache(): void {
  cachedStats = null;
  cacheTimestamp = 0;
  rpcAvailable = true;
}

export function __setRpcAvailable(available: boolean): void {
  rpcAvailable = available;
}

export function __seedCache(stats: FeeStats): void {
  cachedStats = stats;
  cacheTimestamp = Date.now();
}

function fetchFromRpc(): FeeStats {
  if (!rpcAvailable) {
    throw new Error("RPC unavailable");
  }
  return {
    baseFee: {
      min: "100",
      max: "10000",
      mode: "100",
      p10: "100",
      p50: "200",
      p99: "5000",
    },
    resourceFee: {
      min: "500",
      max: "50000",
      mode: "1000",
      p10: "600",
      p50: "1500",
      p99: "30000",
    },
    latestLedger: 12345678,
    cachedAt: Date.now(),
  };
}

router.get("/soroban/fees", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = Date.now();
    if (cachedStats && now - cacheTimestamp < CACHE_TTL_MS) {
      return res.status(200).json({
        success: true,
        data: { ...cachedStats, fromCache: true },
      });
    }

    let stats: FeeStats;
    try {
      stats = fetchFromRpc();
    } catch {
      sendError(res, "RPC_UNAVAILABLE", "Soroban RPC is currently unavailable", 503);
      return;
    }

    cachedStats = stats;
    cacheTimestamp = now;

    return res.status(200).json({
      success: true,
      data: { ...stats, fromCache: false },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
