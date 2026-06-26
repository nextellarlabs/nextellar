import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

const ANCHOR_ID_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

type AnchorMeta = {
  anchorId: string;
  name: string;
  description: string;
  homepage: string;
  supportEmail: string;
  currencies: string[];
  sep10Enabled: boolean;
  sep24Enabled: boolean;
  sep31Enabled: boolean;
};

type CacheEntry = {
  data: AnchorMeta;
  fetchedAt: number;
};

const CACHE_TTL_MS = 30_000;
const anchorCache = new Map<string, CacheEntry>();

const KNOWN_ANCHORS = new Map<string, AnchorMeta>([
  [
    "stellar-anchor",
    {
      anchorId: "stellar-anchor",
      name: "Stellar Anchor",
      description: "A reference anchor for the Stellar network",
      homepage: "https://anchor.stellar.org",
      supportEmail: "support@anchor.stellar.org",
      currencies: ["USDC", "USDT"],
      sep10Enabled: true,
      sep24Enabled: true,
      sep31Enabled: false,
    },
  ],
  [
    "circle-anchor",
    {
      anchorId: "circle-anchor",
      name: "Circle Anchor",
      description: "Circle USDC anchor on the Stellar network",
      homepage: "https://www.circle.com",
      supportEmail: "support@circle.com",
      currencies: ["USDC"],
      sep10Enabled: true,
      sep24Enabled: true,
      sep31Enabled: true,
    },
  ],
]);

export function __resetAnchorCache(): void {
  anchorCache.clear();
}

export function __seedAnchorCache(anchorId: string, data: AnchorMeta, fetchedAt?: number): void {
  anchorCache.set(anchorId, { data, fetchedAt: fetchedAt ?? Date.now() });
}

export function __registerAnchor(anchorId: string, meta: AnchorMeta): void {
  KNOWN_ANCHORS.set(anchorId, meta);
}

export function __removeAnchor(anchorId: string): void {
  KNOWN_ANCHORS.delete(anchorId);
}

function fetchAnchorToml(anchorId: string): AnchorMeta | null {
  return KNOWN_ANCHORS.get(anchorId) ?? null;
}

router.get("/anchors/:id/info", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    if (!ANCHOR_ID_RE.test(id)) {
      sendError(
        res,
        "INVALID_ANCHOR_ID",
        "anchor id must be lowercase alphanumeric with hyphens, 3-63 characters",
        400,
      );
      return;
    }

    const now = Date.now();
    const cached = anchorCache.get(id);

    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      return res.status(200).json({
        success: true,
        data: { ...cached.data, fromCache: true },
      });
    }

    const meta = fetchAnchorToml(id);

    if (!meta) {
      sendError(res, "ANCHOR_NOT_FOUND", `No anchor found with id '${id}'`, 404);
      return;
    }

    anchorCache.set(id, { data: meta, fetchedAt: now });

    return res.status(200).json({
      success: true,
      data: { ...meta, fromCache: false },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
