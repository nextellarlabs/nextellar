import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type Asset = {
  code: string;
  issuer: string;
  amount: string;
};

type PoolRecord = {
  id: string;
  assetA: Asset;
  assetB: Asset;
  totalShares: string;
  recentActivity: {
    tradesLast24h: number;
    volumeLast24h: string;
  };
};

const poolsDb = new Map<string, PoolRecord>([
  ["pool-usdc-xlm", {
    id: "pool-usdc-xlm",
    assetA: { code: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", amount: "1000000.00" },
    assetB: { code: "XLM", issuer: "native", amount: "50000000.00" },
    totalShares: "7071067.81",
    recentActivity: { tradesLast24h: 142, volumeLast24h: "500000.00" }
  }],
  ["pool-zero", {
    id: "pool-zero",
    assetA: { code: "USDT", issuer: "GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53NMYVOZ3A7EKV68", amount: "0.00" },
    assetB: { code: "XLM", issuer: "native", amount: "0.00" },
    totalShares: "0.00",
    recentActivity: { tradesLast24h: 0, volumeLast24h: "0.00" }
  }],
]);

function calculateApy(pool: PoolRecord): string {
  const amountA = parseFloat(pool.assetA.amount);
  const amountB = parseFloat(pool.assetB.amount);
  if (amountA === 0 || amountB === 0) return "0.00";
  const apy = 5.0 + (amountA / (amountA + amountB)) * 2.0;
  return apy.toFixed(2);
}

router.get("/defi/pools/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const pool = poolsDb.get(id);

    if (!pool) {
      sendError(res, "POOL_NOT_FOUND", "Liquidity pool not found", 404);
      return;
    }

    return res.status(200).json({
      success: true,
      data: {
        id: pool.id,
        reserves: {
          assetA: pool.assetA,
          assetB: pool.assetB,
        },
        totalShares: pool.totalShares,
        apyEstimate: calculateApy(pool),
        recentActivity: pool.recentActivity,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export function __resetPools(): void {}
export default router;
