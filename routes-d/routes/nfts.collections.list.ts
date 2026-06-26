import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type NftCollection = {
  id: string;
  name: string;
  category: string;
  floorPrice: string;
  volume24h: string;
  itemCount: number;
};

const CACHE_TTL_MS = 10_000;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

let collectionsStore: NftCollection[] = [];
let cachedCollections: NftCollection[] | null = null;
let cacheTimestamp = 0;

export function __seedCollectionsList(collections: NftCollection[]): void {
  collectionsStore = [...collections];
  cachedCollections = null;
  cacheTimestamp = 0;
}

export function __resetCollectionsList(): void {
  collectionsStore = [];
  cachedCollections = null;
  cacheTimestamp = 0;
}

router.get("/nfts/collections", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = req.query.page !== undefined ? parseInt(req.query.page as string, 10) : DEFAULT_PAGE;
    const limit = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : DEFAULT_LIMIT;

    if (isNaN(page) || page < 1 || isNaN(limit) || limit < 1 || limit > MAX_LIMIT) {
      sendError(res, "INVALID_PAGINATION", "page must be >= 1 and limit must be between 1 and 100", 400);
      return;
    }

    const categoryFilter = typeof req.query.category === "string" ? req.query.category.toLowerCase() : null;
    const sortBy = typeof req.query.sortBy === "string" ? req.query.sortBy : null;

    const now = Date.now();
    let allCollections: NftCollection[];
    let fromCache: boolean;

    if (cachedCollections && now - cacheTimestamp < CACHE_TTL_MS) {
      allCollections = cachedCollections;
      fromCache = true;
    } else {
      allCollections = collectionsStore.map((c) => ({ ...c }));
      cachedCollections = allCollections;
      cacheTimestamp = now;
      fromCache = false;
    }

    const filtered = categoryFilter
      ? allCollections.filter((c) => c.category.toLowerCase() === categoryFilter)
      : allCollections;

    const sorted = [...filtered];
    if (sortBy === "floorPrice") {
      sorted.sort((a, b) => parseFloat(b.floorPrice) - parseFloat(a.floorPrice));
    } else if (sortBy === "volume") {
      sorted.sort((a, b) => parseFloat(b.volume24h) - parseFloat(a.volume24h));
    }

    const total = sorted.length;
    const offset = (page - 1) * limit;
    const paginated = sorted.slice(offset, offset + limit);

    return res.status(200).json({
      success: true,
      data: { collections: paginated, fromCache },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
