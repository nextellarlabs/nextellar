import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type QuoteData = {
  pair: string;
  fromAsset: string;
  toAsset: string;
  inputAmount: number;
  expectedOutput: number;
  effectiveRate: number;
  spread: number;
  priceImpact: number;
  liquidity: "deep" | "thin";
};

const quoteCache = new Map<string, { data: QuoteData; expiresAt: number }>();

const RATES: Record<string, number> = {
  "USDC-NGN": 1500,
  "NGN-USDC": 1 / 1500,
  "USDC-EUR": 0.92,
  "EUR-USDC": 1 / 0.92,
  "XLM-USDC": 0.12,
  "USDC-XLM": 1 / 0.12,
};

router.post("/lancepay/fx/quote", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fromAsset, toAsset, amount } = req.body ?? {};

    if (!fromAsset || !toAsset || typeof amount !== "number" || amount <= 0) {
      sendError(res, "INVALID_INPUT", "fromAsset, toAsset, and positive amount are required", 400);
      return;
    }

    const pair = `${fromAsset.toUpperCase()}-${toAsset.toUpperCase()}`;
    const baseRate = RATES[pair];

    if (!baseRate) {
      sendError(res, "UNKNOWN_PAIR", `Unsupported currency pair: ${pair}`, 404);
      return;
    }

    const cacheKey = `${pair}:${amount}`;
    const cached = quoteCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.status(200).json({ success: true, data: cached.data, cached: true });
    }

    let spread = 0.005;
    let priceImpact = 0.001;

    if (amount >= 100000) {
      spread = 0.03;
      priceImpact = 0.05;
    } else if (amount >= 10000) {
      spread = 0.015;
      priceImpact = 0.01;
    }

    const effectiveRate = baseRate * (1 - spread - priceImpact);
    const expectedOutput = Number((amount * effectiveRate).toFixed(6));

    const quoteData: QuoteData = {
      pair,
      fromAsset: fromAsset.toUpperCase(),
      toAsset: toAsset.toUpperCase(),
      inputAmount: amount,
      expectedOutput,
      effectiveRate,
      spread,
      priceImpact,
      liquidity: amount >= 100000 ? "thin" : "deep",
    };

    quoteCache.set(cacheKey, { data: quoteData, expiresAt: Date.now() + 10000 });

    return res.status(200).json({ success: true, data: quoteData, cached: false });
  } catch (err) {
    return next(err);
  }
});

export function __clearFxQuoteCache() {
  quoteCache.clear();
}

export default router;
