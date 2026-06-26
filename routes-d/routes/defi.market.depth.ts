import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

// Asset pair format: CODE-ISSUER or CODE (for native XLM)
// e.g. "XLM:USDC-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
const PAIR_REGEX = /^[A-Z0-9]{1,12}(?:-[A-Z0-9]{1,56})?:[A-Z0-9]{1,12}(?:-[A-Z0-9]{1,56})?$/;

const DEFAULT_MAX_DEPTH = 20;
const ABSOLUTE_MAX_DEPTH = 100;

type OrderLevel = {
  price: string;
  amount: string;
  total: string;
};

type MarketDepth = {
  pair: string;
  bids: OrderLevel[];
  asks: OrderLevel[];
  spread: string;
  fromCache: boolean;
};

type BookConfig = {
  bids: Omit<OrderLevel, "total">[];
  asks: Omit<OrderLevel, "total">[];
};

// Simulated order books keyed by pair
const orderBookStore = new Map<string, BookConfig>([
  [
    "XLM:USDC-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    {
      bids: [
        { price: "0.0910", amount: "5000" },
        { price: "0.0905", amount: "8000" },
        { price: "0.0900", amount: "12000" },
      ],
      asks: [
        { price: "0.0915", amount: "4500" },
        { price: "0.0920", amount: "7500" },
        { price: "0.0925", amount: "10000" },
      ],
    },
  ],
  [
    "USDC-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5:XLM",
    {
      bids: [
        { price: "10.90", amount: "200" },
        { price: "10.85", amount: "150" },
      ],
      asks: [
        { price: "10.95", amount: "180" },
        { price: "11.00", amount: "300" },
      ],
    },
  ],
]);

const CACHE_TTL_MS = 5_000;
const depthCache = new Map<string, { data: MarketDepth; expires: number }>();

export function __resetDepthStore(): void {
  orderBookStore.clear();
  depthCache.clear();
}

export function __seedOrderBook(pair: string, config: BookConfig): void {
  orderBookStore.set(pair, config);
}

export function __seedDepthCache(key: string, data: MarketDepth): void {
  depthCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

function computeLevels(
  levels: Omit<OrderLevel, "total">[],
  limit: number,
): OrderLevel[] {
  return levels.slice(0, limit).map((l) => ({
    price: l.price,
    amount: l.amount,
    total: (parseFloat(l.price) * parseFloat(l.amount)).toFixed(7),
  }));
}

router.get(
  "/defi/market/:pair/depth",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { pair } = req.params;
      const depthParam = req.query.depth as string | undefined;

      if (!PAIR_REGEX.test(pair)) {
        sendError(
          res,
          "INVALID_PAIR_FORMAT",
          "pair must be in the format BASE:QUOTE or BASE-ISSUER:QUOTE-ISSUER using uppercase alphanumeric characters",
          400,
        );
        return;
      }

      let maxDepth = DEFAULT_MAX_DEPTH;
      if (depthParam !== undefined) {
        const parsed = parseInt(depthParam, 10);
        if (isNaN(parsed) || parsed < 1) {
          sendError(res, "INVALID_DEPTH", "depth must be a positive integer", 400);
          return;
        }
        if (parsed > ABSOLUTE_MAX_DEPTH) {
          sendError(
            res,
            "DEPTH_EXCEEDS_MAX",
            `depth cannot exceed ${ABSOLUTE_MAX_DEPTH}`,
            400,
          );
          return;
        }
        maxDepth = parsed;
      }

      const cacheKey = `${pair}:${maxDepth}`;
      const now = Date.now();
      const cached = depthCache.get(cacheKey);

      if (cached && cached.expires > now) {
        return res.status(200).json({
          success: true,
          data: { ...cached.data, fromCache: true },
        });
      }

      const book = orderBookStore.get(pair);

      if (!book) {
        sendError(res, "UNKNOWN_PAIR", "No order book found for the requested pair", 404);
        return;
      }

      const bids = computeLevels(book.bids, maxDepth);
      const asks = computeLevels(book.asks, maxDepth);

      const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : null;
      const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : null;
      const spread =
        bestBid !== null && bestAsk !== null
          ? (bestAsk - bestBid).toFixed(7)
          : "N/A";

      const result: MarketDepth = {
        pair,
        bids,
        asks,
        spread,
        fromCache: false,
      };

      depthCache.set(cacheKey, { data: result, expires: now + CACHE_TTL_MS });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
