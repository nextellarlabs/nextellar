import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type Asset = {
  code: string;
  issuer?: string;
};

type QuoteBody = {
  fromAsset: Asset;
  toAsset: Asset;
  amount: string;
};

type QuoteResult = {
  fromAsset: Asset;
  toAsset: Asset;
  inputAmount: string;
  outputAmount: string;
  fees: { protocol: string; network: string };
  priceImpact: string;
  fromCache: boolean;
};

type PairConfig = {
  outputRatio: number;
  priceImpact: string;
  fees: { protocol: string; network: string };
};

const knownPairs = new Map<string, PairConfig>([
  ["USDC:XLM", { outputRatio: 0.997, priceImpact: "0.04", fees: { protocol: "0.30", network: "0.01" } }],
  ["BTC:XLM", { outputRatio: 0.940, priceImpact: "5.20", fees: { protocol: "0.50", network: "0.10" } }],
]);

const CACHE_TTL_MS = 5_000;
const quoteCache = new Map<string, { data: QuoteResult; expires: number }>();

export function __resetQuoteCache(): void {
  quoteCache.clear();
}

export function __seedQuoteCache(key: string, data: QuoteResult): void {
  quoteCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

router.post("/defi/swap/quote", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as QuoteBody;

    if (!body.fromAsset || typeof body.fromAsset !== "object") {
      sendError(res, "INVALID_FROM_ASSET", "fromAsset is required and must be an object", 400);
      return;
    }

    if (!body.fromAsset.code || typeof body.fromAsset.code !== "string") {
      sendError(res, "INVALID_FROM_ASSET_CODE", "fromAsset.code is required and must be a string", 400);
      return;
    }

    if (!body.toAsset || typeof body.toAsset !== "object") {
      sendError(res, "INVALID_TO_ASSET", "toAsset is required and must be an object", 400);
      return;
    }

    if (!body.toAsset.code || typeof body.toAsset.code !== "string") {
      sendError(res, "INVALID_TO_ASSET_CODE", "toAsset.code is required and must be a string", 400);
      return;
    }

    if (!body.amount || typeof body.amount !== "string") {
      sendError(res, "INVALID_AMOUNT", "amount is required and must be a string", 400);
      return;
    }

    const amountNum = parseFloat(body.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      sendError(res, "INVALID_AMOUNT", "amount must be a positive number", 400);
      return;
    }

    if (
      body.fromAsset.code === body.toAsset.code &&
      body.fromAsset.issuer === body.toAsset.issuer
    ) {
      sendError(res, "INVALID_ASSET_PAIR", "fromAsset and toAsset cannot be the same", 400);
      return;
    }

    const pairKey = `${body.fromAsset.code}:${body.toAsset.code}`;
    const pairConfig = knownPairs.get(pairKey);

    if (!pairConfig) {
      sendError(res, "UNKNOWN_PAIR", "No liquidity path found for the requested asset pair", 422);
      return;
    }

    const cacheKey = `${pairKey}:${body.amount}`;
    const now = Date.now();
    const cached = quoteCache.get(cacheKey);

    if (cached && cached.expires > now) {
      return res.status(201).json({
        success: true,
        data: { ...cached.data, fromCache: true },
      });
    }

    const outputAmount = (amountNum * pairConfig.outputRatio).toFixed(7);

    const result: QuoteResult = {
      fromAsset: body.fromAsset,
      toAsset: body.toAsset,
      inputAmount: body.amount,
      outputAmount,
      fees: pairConfig.fees,
      priceImpact: pairConfig.priceImpact,
      fromCache: false,
    };

    quoteCache.set(cacheKey, { data: result, expires: now + CACHE_TTL_MS });

    return res.status(201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
