import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type DisplayMetadata = {
  name: string;
  image?: string;
  description?: string;
};

type NftHolding = {
  id: string;
  tokenId: string;
  collectionId: string;
  ownerUserId: string;
  acquiredAt: string;
};

const holdingsByUser = new Map<string, NftHolding[]>();
const metadataByToken = new Map<string, DisplayMetadata>();

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePositiveInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string") return NaN;
  return parseInt(value, 10);
}

router.get("/nfts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.headers["x-user-id"] as string | undefined;

    if (!userId) {
      sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
      return;
    }

    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);
    const limit = parsePositiveInteger(req.query.limit, DEFAULT_LIMIT);

    if (isNaN(page) || page < 1 || isNaN(limit) || limit < 1 || limit > MAX_LIMIT) {
      sendError(res, "INVALID_PAGINATION", "page must be >= 1 and limit must be between 1 and 100", 400);
      return;
    }

    const collection = req.query.collection as string | undefined;
    const allHoldings = holdingsByUser.get(userId) ?? [];
    const filtered = collection
      ? allHoldings.filter((holding) => holding.collectionId === collection)
      : allHoldings;

    const offset = (page - 1) * limit;
    const data = filtered.slice(offset, offset + limit).map((holding) => ({
      ...holding,
      displayMetadata: metadataByToken.get(holding.tokenId) ?? null,
    }));

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total: filtered.length,
        totalPages: Math.ceil(filtered.length / limit) || 1,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export function __seedNftHoldings(userId: string, holdings: NftHolding[]): void {
  holdingsByUser.set(userId, holdings);
}

export function __seedNftMetadata(tokenId: string, metadata: DisplayMetadata): void {
  metadataByToken.set(tokenId, metadata);
}

export function __resetNftList(): void {
  holdingsByUser.clear();
  metadataByToken.clear();
}

export default router;
