import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type FeeEntry = {
  operation: "deposit" | "withdrawal";
  asset: string;
  fixed: string;
  percent: string;
  minAmount?: string;
  maxAmount?: string;
};

type AnchorFeeSchedule = {
  anchorId: string;
  name: string;
  fees: FeeEntry[];
  sep24Supported: boolean;
  fromCache: boolean;
};

type AnchorConfig = {
  name: string;
  sep24Supported: boolean;
  fees: FeeEntry[];
};

const anchorRegistry = new Map<string, AnchorConfig>([
  [
    "anchor-circle",
    {
      name: "Circle",
      sep24Supported: true,
      fees: [
        { operation: "deposit", asset: "USDC", fixed: "0.00", percent: "0.10", minAmount: "10" },
        { operation: "withdrawal", asset: "USDC", fixed: "1.00", percent: "0.20", minAmount: "10" },
      ],
    },
  ],
  [
    "anchor-stronghold",
    {
      name: "Stronghold",
      sep24Supported: true,
      fees: [
        { operation: "deposit", asset: "SHx", fixed: "0.00", percent: "0.05" },
        { operation: "withdrawal", asset: "SHx", fixed: "0.50", percent: "0.10" },
      ],
    },
  ],
  [
    "anchor-no-fees",
    {
      name: "NoFeeAnchor",
      sep24Supported: false,
      fees: [],
    },
  ],
]);

const CACHE_TTL_MS = 30_000;
const feeCache = new Map<string, { data: AnchorFeeSchedule; expires: number }>();

export function __resetFeeCache(): void {
  feeCache.clear();
}

export function __resetAnchorRegistry(): void {
  anchorRegistry.clear();
  feeCache.clear();
}

export function __seedAnchor(id: string, config: AnchorConfig): void {
  anchorRegistry.set(id, config);
}

export function __seedFeeCache(key: string, data: AnchorFeeSchedule): void {
  feeCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

router.get("/anchors/:id/fees", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    if (!id || id.trim() === "") {
      sendError(res, "INVALID_ANCHOR_ID", "Anchor id is required", 400);
      return;
    }

    const anchorId = id.trim();
    const now = Date.now();
    const cached = feeCache.get(anchorId);

    if (cached && cached.expires > now) {
      return res.status(200).json({
        success: true,
        data: { ...cached.data, fromCache: true },
      });
    }

    const anchor = anchorRegistry.get(anchorId);

    if (!anchor) {
      sendError(res, "ANCHOR_NOT_FOUND", "No anchor found with the given id", 404);
      return;
    }

    if (anchor.fees.length === 0) {
      sendError(res, "FEES_NOT_AVAILABLE", "Fee schedule not available for this anchor", 404);
      return;
    }

    const result: AnchorFeeSchedule = {
      anchorId,
      name: anchor.name,
      fees: anchor.fees,
      sep24Supported: anchor.sep24Supported,
      fromCache: false,
    };

    feeCache.set(anchorId, { data: result, expires: now + CACHE_TTL_MS });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
