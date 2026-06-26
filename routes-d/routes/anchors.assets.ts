import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type AnchorAsset = {
  code: string;
  issuer: string;
  minAmount?: string;
  maxAmount?: string;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
};

type AnchorAssetResponse = Omit<AnchorAsset, "minAmount" | "maxAmount"> & {
  minAmount: string | null;
  maxAmount: string | null;
};

type AnchorRecord = {
  id: string;
  name: string;
  assets: AnchorAsset[];
};

const CACHE_TTL_MS = 30_000;

const anchorsStore = new Map<string, AnchorRecord>();
const assetsCache = new Map<string, { data: AnchorAssetResponse[]; ts: number }>();

export function __seedAnchor(id: string, record: AnchorRecord): void {
  anchorsStore.set(id, record);
  assetsCache.delete(id);
}

export function __resetAnchorsAssets(): void {
  anchorsStore.clear();
  assetsCache.clear();
}

router.get("/anchors/:id/assets", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const anchor = anchorsStore.get(id);
    if (!anchor) {
      sendError(res, "ANCHOR_NOT_FOUND", `Anchor ${id} not found`, 404);
      return;
    }

    const now = Date.now();
    const cached = assetsCache.get(id);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      return res.status(200).json({ success: true, data: cached.data, fromCache: true });
    }

    const assets: AnchorAssetResponse[] = anchor.assets.map((asset) => ({
      code:            asset.code,
      issuer:          asset.issuer,
      minAmount:       asset.minAmount ?? null,
      maxAmount:       asset.maxAmount ?? null,
      depositEnabled:  asset.depositEnabled,
      withdrawEnabled: asset.withdrawEnabled,
    }));

    assetsCache.set(id, { data: assets, ts: now });

    return res.status(200).json({ success: true, data: assets, fromCache: false });
  } catch (err) {
    return next(err);
  }
});

export default router;
