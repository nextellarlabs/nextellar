import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type Asset = {
  code: string;
  issuer?: string;
};

type OrderBookQuery = {
  buyingAsset: Asset;
  sellingAsset: Asset;
  limit?: string;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

/**
 * GET /stellar/orderbook
 * Return the current Stellar order book for an asset pair.
 */
router.get(
  "/stellar/orderbook",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        buyingAssetCode,
        buyingAssetIssuer,
        sellingAssetCode,
        sellingAssetIssuer,
        limit: limitStr,
      } = req.query;

      // Validate buying asset code
      if (!buyingAssetCode || typeof buyingAssetCode !== "string") {
        sendError(res, "INVALID_BUYING_ASSET_CODE", "buyingAssetCode is required and must be a string", 400);
        return;
      }

      // Validate selling asset code
      if (!sellingAssetCode || typeof sellingAssetCode !== "string") {
        sendError(res, "INVALID_SELLING_ASSET_CODE", "sellingAssetCode is required and must be a string", 400);
        return;
      }

      // Parse limit
      let limit = DEFAULT_LIMIT;
      if (limitStr) {
        const parsedLimit = parseInt(limitStr as string, 10);
        if (isNaN(parsedLimit) || parsedLimit <= 0) {
          sendError(res, "INVALID_LIMIT", "limit must be a positive number", 400);
          return;
        }
        limit = Math.min(parsedLimit, MAX_LIMIT);
      }

      // Check if assets are the same
      if (
        buyingAssetCode === sellingAssetCode &&
        (!buyingAssetIssuer || !sellingAssetIssuer || buyingAssetIssuer === sellingAssetIssuer)
      ) {
        sendError(res, "INVALID_ASSET_PAIR", "Buying and selling assets cannot be the same", 400);
        return;
      }

      // Mock order book response
      const orderBook = {
        bids: [
          {
            price: "2.5",
            amount: "1000",
            pricr: { n: 5, d: 2 },
          },
          {
            price: "2.4",
            amount: "1500",
            pricr: { n: 12, d: 5 },
          },
          {
            price: "2.3",
            amount: "2000",
            pricr: { n: 23, d: 10 },
          },
        ],
        asks: [
          {
            price: "2.6",
            amount: "800",
            pricr: { n: 13, d: 5 },
          },
          {
            price: "2.7",
            amount: "1200",
            pricr: { n: 27, d: 10 },
          },
          {
            price: "2.8",
            amount: "600",
            pricr: { n: 14, d: 5 },
          },
        ],
        base: {
          asset_type: sellingAssetCode === "native" ? "native" : "credit_alphanum12",
          asset_code: sellingAssetCode,
          asset_issuer: sellingAssetIssuer || undefined,
        },
        counter: {
          asset_type: buyingAssetCode === "native" ? "native" : "credit_alphanum12",
          asset_code: buyingAssetCode,
          asset_issuer: buyingAssetIssuer || undefined,
        },
      };

      // Cap results to requested limit
      const cappedOrderBook = {
        ...orderBook,
        bids: orderBook.bids.slice(0, limit),
        asks: orderBook.asks.slice(0, limit),
      };

      return res.status(200).json({
        success: true,
        data: cappedOrderBook,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
