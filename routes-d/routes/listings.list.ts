import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AssetType = "token" | "nft" | "bond" | "equity" | "commodity";

export type ListingStatus = "open" | "filled" | "cancelled" | "expired";

export interface Listing {
  id: string;
  sellerId: string;
  assetCode: string;
  assetIssuer: string;
  assetType: AssetType;
  collectionId?: string;
  price: number;
  currency: string;
  quantity: number;
  status: ListingStatus;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// In-memory store (seeded by tests or future persistence layer)
// ---------------------------------------------------------------------------

let listingStore: Listing[] = [];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const VALID_ASSET_TYPES: AssetType[] = [
  "token",
  "nft",
  "bond",
  "equity",
  "commodity",
];

const VALID_SORT_BY = ["price_asc", "price_desc", "newest", "oldest"] as const;
type SortBy = (typeof VALID_SORT_BY)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePositiveInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string") return NaN;
  const parsed = parseInt(value, 10);
  return parsed;
}

function parsePositiveFloat(value: unknown): number | null {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string") return NaN;
  const parsed = parseFloat(value);
  return parsed;
}

// ---------------------------------------------------------------------------
// Route: GET /listings
//
// Query parameters:
//   collection    – filter by collectionId (exact match)
//   assetType     – filter by assetType (one of: token | nft | bond | equity | commodity)
//   minPrice      – lower bound on price (inclusive, numeric)
//   maxPrice      – upper bound on price (inclusive, numeric)
//   sortBy        – sort order: price_asc | price_desc | newest | oldest (default: newest)
//   page          – page number >= 1 (default: 1)
//   limit         – items per page 1–100 (default: 20)
//
// Only "open" listings are returned by default.
// ---------------------------------------------------------------------------

router.get("/listings", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      collection,
      assetType,
      minPrice,
      maxPrice,
      sortBy = "newest",
      page: rawPage,
      limit: rawLimit,
    } = req.query;

    // --- Validate pagination ---

    const page = parsePositiveInteger(rawPage, DEFAULT_PAGE);
    const limit = parsePositiveInteger(rawLimit, DEFAULT_LIMIT);

    if (isNaN(page) || page < 1) {
      sendError(res, "INVALID_PAGE", "page must be a positive integer", 400);
      return;
    }

    if (isNaN(limit) || limit < 1 || limit > MAX_LIMIT) {
      sendError(
        res,
        "INVALID_LIMIT",
        `limit must be between 1 and ${MAX_LIMIT}`,
        400,
      );
      return;
    }

    // --- Validate assetType ---

    if (
      assetType !== undefined &&
      typeof assetType === "string" &&
      !VALID_ASSET_TYPES.includes(assetType as AssetType)
    ) {
      sendError(
        res,
        "INVALID_ASSET_TYPE",
        `assetType must be one of: ${VALID_ASSET_TYPES.join(", ")}`,
        400,
      );
      return;
    }

    // --- Validate sortBy ---

    if (!VALID_SORT_BY.includes(sortBy as SortBy)) {
      sendError(
        res,
        "INVALID_SORT_BY",
        `sortBy must be one of: ${VALID_SORT_BY.join(", ")}`,
        400,
      );
      return;
    }

    // --- Validate price range ---

    const min = parsePositiveFloat(minPrice);
    const max = parsePositiveFloat(maxPrice);

    if (min !== null && (isNaN(min) || min < 0)) {
      sendError(res, "INVALID_MIN_PRICE", "minPrice must be a non-negative number", 400);
      return;
    }

    if (max !== null && (isNaN(max) || max < 0)) {
      sendError(res, "INVALID_MAX_PRICE", "maxPrice must be a non-negative number", 400);
      return;
    }

    if (min !== null && max !== null && min > max) {
      sendError(
        res,
        "INVALID_PRICE_RANGE",
        "minPrice must not be greater than maxPrice",
        400,
      );
      return;
    }

    // --- Filter ---

    let results = listingStore.filter((l) => l.status === "open");

    if (collection && typeof collection === "string") {
      results = results.filter((l) => l.collectionId === collection);
    }

    if (assetType && typeof assetType === "string") {
      results = results.filter((l) => l.assetType === assetType);
    }

    if (min !== null) {
      results = results.filter((l) => l.price >= min);
    }

    if (max !== null) {
      results = results.filter((l) => l.price <= max);
    }

    // --- Sort ---

    switch (sortBy as SortBy) {
      case "price_asc":
        results.sort((a, b) => a.price - b.price);
        break;
      case "price_desc":
        results.sort((a, b) => b.price - a.price);
        break;
      case "oldest":
        results.sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        break;
      case "newest":
      default:
        results.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        break;
    }

    // --- Paginate ---

    const total = results.length;
    const offset = (page - 1) * limit;
    const paged = results.slice(offset, offset + limit);

    return res.status(200).json({
      success: true,
      data: paged,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasNext: offset + limit < total,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// Test helpers (exported only for test seeding — never call in production)
// ---------------------------------------------------------------------------

export function __seedListings(listings: Listing[]): void {
  listingStore = [...listings];
}

export function __resetListings(): void {
  listingStore = [];
}

export function __getListings(): Listing[] {
  return [...listingStore];
}

export default router;
