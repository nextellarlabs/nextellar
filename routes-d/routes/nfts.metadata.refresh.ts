import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type MetadataRefreshBody = {
  tokenId: string;
};

type TokenRecord = {
  tokenId: string;
  collectionId: string;
  metadataUri: string;
  metadata: {
    name: string;
    image?: string;
    description?: string;
  };
  refreshedAt?: string;
};

const tokens = new Map<string, TokenRecord>();
const metadataCache = new Map<string, TokenRecord["metadata"]>();
const refreshRateLimits = new Map<string, { count: number; windowStart: number }>();

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REFRESHES_PER_WINDOW = 1;

function getRateEntry(tokenId: string): { count: number; windowStart: number } {
  const now = Date.now();
  const current = refreshRateLimits.get(tokenId);

  if (!current || now - current.windowStart >= RATE_LIMIT_WINDOW_MS) {
    const freshEntry = { count: 0, windowStart: now };
    refreshRateLimits.set(tokenId, freshEntry);
    return freshEntry;
  }

  return current;
}

function fetchPinnedMetadata(token: TokenRecord): TokenRecord["metadata"] {
  return {
    ...token.metadata,
    name: token.metadata.name.trim(),
  };
}

router.post("/nfts/metadata/refresh", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as MetadataRefreshBody;

    if (!body.tokenId || typeof body.tokenId !== "string") {
      sendError(res, "MISSING_TOKEN", "tokenId is required", 400);
      return;
    }

    const token = tokens.get(body.tokenId);
    if (!token) {
      sendError(res, "TOKEN_NOT_FOUND", "NFT token was not found", 404);
      return;
    }

    const rateEntry = getRateEntry(body.tokenId);
    rateEntry.count += 1;

    if (rateEntry.count > MAX_REFRESHES_PER_WINDOW) {
      sendError(res, "RATE_LIMITED", "metadata refresh is temporarily throttled for this token", 429);
      return;
    }

    const metadata = fetchPinnedMetadata(token);
    const refreshedAt = new Date().toISOString();

    metadataCache.delete(body.tokenId);
    tokens.set(body.tokenId, {
      ...token,
      metadata,
      refreshedAt,
    });

    return res.status(200).json({
      success: true,
      data: {
        tokenId: body.tokenId,
        collectionId: token.collectionId,
        metadata,
        refreshedAt,
        cacheInvalidated: true,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export function __seedNftToken(token: TokenRecord): void {
  tokens.set(token.tokenId, token);
}

export function __seedMetadataCache(tokenId: string, metadata: TokenRecord["metadata"]): void {
  metadataCache.set(tokenId, metadata);
}

export function __hasMetadataCache(tokenId: string): boolean {
  return metadataCache.has(tokenId);
}

export function __resetMetadataRefresh(): void {
  tokens.clear();
  metadataCache.clear();
  refreshRateLimits.clear();
}

export default router;
