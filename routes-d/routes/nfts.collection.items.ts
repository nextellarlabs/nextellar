import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type TraitAttribute = {
  trait_type: string;
  value: string;
};

type DisplayMetadata = {
  name: string;
  image?: string;
  attributes?: TraitAttribute[];
};

type CollectionItem = {
  id: string;
  tokenId: string;
  collectionId: string;
  ownerUserId: string;
  acquiredAt: string;
};

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const itemsByCollection = new Map<string, CollectionItem[]>();
const metadataByToken = new Map<string, DisplayMetadata>();

export function __seedCollectionItems(collectionId: string, items: CollectionItem[]): void {
  itemsByCollection.set(collectionId, items);
}

export function __seedCollectionItemMetadata(tokenId: string, metadata: DisplayMetadata): void {
  metadataByToken.set(tokenId, metadata);
}

export function __resetCollectionItems(): void {
  itemsByCollection.clear();
  metadataByToken.clear();
}

router.get("/collections/:id/items", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const page = req.query.page !== undefined ? parseInt(req.query.page as string, 10) : DEFAULT_PAGE;
    const limit = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : DEFAULT_LIMIT;

    if (isNaN(page) || page < 1 || isNaN(limit) || limit < 1 || limit > MAX_LIMIT) {
      sendError(res, "INVALID_PAGINATION", "page must be >= 1 and limit must be between 1 and 100", 400);
      return;
    }

    const traitType = typeof req.query.trait_type === "string" ? req.query.trait_type : null;
    const traitValue = typeof req.query.trait_value === "string" ? req.query.trait_value : null;

    const allItems = itemsByCollection.get(id) ?? [];

    const filtered =
      traitType && traitValue
        ? allItems.filter((item) => {
            const meta = metadataByToken.get(item.tokenId);
            return (
              meta?.attributes?.some(
                (attr) => attr.trait_type === traitType && attr.value === traitValue,
              ) ?? false
            );
          })
        : allItems;

    const total = filtered.length;
    const offset = (page - 1) * limit;
    const paginated = filtered.slice(offset, offset + limit).map((item) => ({
      ...item,
      displayMetadata: metadataByToken.get(item.tokenId) ?? null,
    }));

    return res.status(200).json({
      success: true,
      data: paginated,
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
