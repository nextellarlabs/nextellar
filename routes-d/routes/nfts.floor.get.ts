import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type Listing = {
  collectionId: string;
  price: number;
  seller: string;
  tokenId: string;
  active: boolean;
};

type FloorResult = {
  collectionId: string;
  floorPrice: number;
  currency: string;
  activeListings: number;
  fromCache: boolean;
};

const listingStore = new Map<string, Listing[]>();

const CACHE_TTL_MS = 10_000;
const floorCache = new Map<string, { data: FloorResult; expires: number }>();

export function __resetListingStore(): void {
  listingStore.clear();
  floorCache.clear();
}

export function __seedListings(collectionId: string, listings: Listing[]): void {
  listingStore.set(collectionId, listings);
}

export function __seedFloorCache(key: string, data: FloorResult): void {
  floorCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

router.get("/nfts/floor", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const collectionId = req.query.collectionId as string | undefined;

    if (!collectionId || typeof collectionId !== "string" || collectionId.trim() === "") {
      sendError(res, "INVALID_COLLECTION_ID", "collectionId query parameter is required", 400);
      return;
    }

    const cacheKey = collectionId.trim();
    const now = Date.now();
    const cached = floorCache.get(cacheKey);

    if (cached && cached.expires > now) {
      return res.status(200).json({
        success: true,
        data: { ...cached.data, fromCache: true },
      });
    }

    const listings = listingStore.get(cacheKey);

    if (!listings) {
      sendError(res, "COLLECTION_NOT_FOUND", "No collection found with the given collectionId", 404);
      return;
    }

    const activeListings = listings.filter((l) => l.active);

    if (activeListings.length === 0) {
      sendError(res, "NO_ACTIVE_LISTINGS", "No active listings found for this collection", 404);
      return;
    }

    const floorPrice = Math.min(...activeListings.map((l) => l.price));

    const result: FloorResult = {
      collectionId: cacheKey,
      floorPrice,
      currency: "XLM",
      activeListings: activeListings.length,
      fromCache: false,
    };

    floorCache.set(cacheKey, { data: result, expires: now + CACHE_TTL_MS });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
