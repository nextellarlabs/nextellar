import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type Asset = {
  code: string;
  issuer?: string;
};

type TradeAggregationQuery = {
  baseAsset: Asset;
  counterAsset: Asset;
  resolution: string;
  startTime?: string;
  endTime?: string;
};

type TradeAggregation = {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

type TradeAggregationResponse = {
  baseAsset: Asset;
  counterAsset: Asset;
  resolution: string;
  aggregations: TradeAggregation[];
};

const VALID_RESOLUTIONS = new Set(["1m", "5m", "15m", "1h", "1d"]);

const MAX_TIME_RANGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const MOCK_TRADE_DATA: TradeAggregation[] = [
  {
    timestamp: 1704067200000,
    open: "2.50",
    high: "2.52",
    low: "2.49",
    close: "2.51",
    volume: "150000",
  },
  {
    timestamp: 1704070800000,
    open: "2.51",
    high: "2.53",
    low: "2.50",
    close: "2.52",
    volume: "180000",
  },
  {
    timestamp: 1704074400000,
    open: "2.52",
    high: "2.55",
    low: "2.51",
    close: "2.54",
    volume: "210000",
  },
];

/**
 * GET /stellar/trades
 * Return Stellar trade aggregations over the requested resolution.
 */
router.get(
  "/stellar/trades",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        baseAssetCode,
        baseAssetIssuer,
        counterAssetCode,
        counterAssetIssuer,
        resolution,
        startTime,
        endTime,
      } = req.query;

      // Validate base asset code
      if (!baseAssetCode || typeof baseAssetCode !== "string") {
        sendError(res, "INVALID_BASE_ASSET", "baseAssetCode is required and must be a string", 400);
        return;
      }

      // Validate counter asset code
      if (!counterAssetCode || typeof counterAssetCode !== "string") {
        sendError(
          res,
          "INVALID_COUNTER_ASSET",
          "counterAssetCode is required and must be a string",
          400,
        );
        return;
      }

      // Validate resolution
      if (!resolution || typeof resolution !== "string") {
        sendError(res, "INVALID_RESOLUTION", "resolution is required and must be a string", 400);
        return;
      }

      if (!VALID_RESOLUTIONS.has(resolution)) {
        sendError(
          res,
          "INVALID_RESOLUTION",
          `resolution must be one of: ${Array.from(VALID_RESOLUTIONS).join(", ")}`,
          400,
        );
        return;
      }

      // Cap the time range to prevent excessive queries
      let startTs = startTime ? parseInt(startTime as string, 10) : Date.now() - 24 * 60 * 60 * 1000;
      let endTs = endTime ? parseInt(endTime as string, 10) : Date.now();

      if (isNaN(startTs) || isNaN(endTs)) {
        sendError(res, "INVALID_TIME_RANGE", "startTime and endTime must be valid numbers (milliseconds)", 400);
        return;
      }

      if (startTs >= endTs) {
        sendError(res, "INVALID_TIME_RANGE", "startTime must be before endTime", 400);
        return;
      }

      const timeRangeMs = endTs - startTs;
      if (timeRangeMs > MAX_TIME_RANGE_MS) {
        // Cap the range: shift startTime forward to respect max range
        startTs = endTs - MAX_TIME_RANGE_MS;
      }

      const baseAsset: Asset = { code: baseAssetCode as string };
      if (baseAssetIssuer) {
        baseAsset.issuer = baseAssetIssuer as string;
      }

      const counterAsset: Asset = { code: counterAssetCode as string };
      if (counterAssetIssuer) {
        counterAsset.issuer = counterAssetIssuer as string;
      }

      const response: TradeAggregationResponse = {
        baseAsset,
        counterAsset,
        resolution,
        aggregations: MOCK_TRADE_DATA,
      };

      return res.status(200).json({
        success: true,
        data: response,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __resetTradeAggregations(): void {}

export default router;