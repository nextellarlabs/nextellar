import { Router, Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { sendError } from "../lib/response.js";

const router = Router();

export type AssetType = "token" | "nft" | "bond" | "equity" | "commodity";
export type ListingStatus = "open" | "filled" | "cancelled";
export type EscrowStatus = "locked" | "settled" | "released";

export interface TokenizedAsset {
  assetId: string;
  ownerId: string;
  assetCode: string;
  assetIssuer: string;
  assetType: AssetType;
  quantity: number;
  collectionId?: string;
}

export interface EscrowLock {
  id: string;
  assetId: string;
  ownerId: string;
  quantity: number;
  status: EscrowStatus;
  createdAt: string;
  resolvedAt?: string;
}

export interface MarketplaceListing {
  id: string;
  sellerId: string;
  assetId: string;
  assetCode: string;
  assetIssuer: string;
  assetType: AssetType;
  collectionId?: string;
  quantity: number;
  price: number;
  currency: string;
  status: ListingStatus;
  escrowId: string;
  createdAt: string;
  updatedAt: string;
}

const assets = new Map<string, TokenizedAsset>();
const listings = new Map<string, MarketplaceListing>();
const escrows = new Map<string, EscrowLock>();
const lockedQuantities = new Map<string, number>();

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bodyObject(req: Request): Record<string, unknown> | null {
  const body = req.body as unknown;
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function positiveInteger(value: unknown): number | null {
  if (value === undefined) return 1;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function positiveFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function activeListingForAsset(assetId: string): MarketplaceListing | undefined {
  return [...listings.values()].find(
    (listing) => listing.assetId === assetId && listing.status === "open",
  );
}

function availableQuantity(asset: TokenizedAsset): number {
  return asset.quantity - (lockedQuantities.get(asset.assetId) ?? 0);
}

router.post(
  "/listings",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ownerId = headerValue(req, "x-owner-id");
      if (!ownerId) {
        sendError(res, "UNAUTHORIZED", "x-owner-id header is required", 401);
        return;
      }

      const body = bodyObject(req);
      if (!body) {
        sendError(res, "INVALID_BODY", "request body must be an object", 400);
        return;
      }

      const assetId = typeof body.assetId === "string" ? body.assetId.trim() : "";
      if (!assetId) {
        sendError(res, "INVALID_ASSET_ID", "assetId is required", 400);
        return;
      }

      const asset = assets.get(assetId);
      if (!asset) {
        sendError(res, "ASSET_NOT_FOUND", "asset was not found", 404);
        return;
      }

      if (asset.ownerId !== ownerId) {
        sendError(res, "NOT_OWNER", "caller does not own the asset", 403);
        return;
      }

      const quantity = positiveInteger(body.quantity);
      if (quantity === null) {
        sendError(res, "INVALID_QUANTITY", "quantity must be a positive integer", 400);
        return;
      }

      const price = positiveFiniteNumber(body.price);
      if (price === null) {
        sendError(res, "INVALID_PRICE", "price must be a positive finite number", 400);
        return;
      }

      const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
      if (!currency) {
        sendError(res, "INVALID_CURRENCY", "currency is required", 400);
        return;
      }

      if (activeListingForAsset(assetId)) {
        sendError(res, "DUPLICATE_LISTING", "asset already has an open listing", 409);
        return;
      }

      if (quantity > availableQuantity(asset)) {
        sendError(res, "ASSET_UNAVAILABLE", "requested quantity is not available", 409);
        return;
      }

      const now = new Date().toISOString();
      const escrowId = `escrow-${randomUUID()}`;
      const listing: MarketplaceListing = {
        id: `listing-${randomUUID()}`,
        sellerId: ownerId,
        assetId,
        assetCode: asset.assetCode,
        assetIssuer: asset.assetIssuer,
        assetType: asset.assetType,
        ...(asset.collectionId ? { collectionId: asset.collectionId } : {}),
        quantity,
        price,
        currency,
        status: "open",
        escrowId,
        createdAt: now,
        updatedAt: now,
      };
      const escrow: EscrowLock = {
        id: escrowId,
        assetId,
        ownerId,
        quantity,
        status: "locked",
        createdAt: now,
      };

      listings.set(listing.id, listing);
      escrows.set(escrow.id, escrow);
      lockedQuantities.set(assetId, (lockedQuantities.get(assetId) ?? 0) + quantity);

      res.status(201).json({ success: true, data: listing });
    } catch (error) {
      next(error);
    }
  },
);

/** Close a listing and release or settle its escrow for a future close route. */
export function __closeListing(listingId: string, status: "filled" | "cancelled"): boolean {
  const listing = listings.get(listingId);
  if (!listing || listing.status !== "open") return false;

  const escrow = escrows.get(listing.escrowId);
  if (!escrow || escrow.status !== "locked") return false;

  const now = new Date().toISOString();
  listing.status = status;
  listing.updatedAt = now;
  escrow.status = status === "filled" ? "settled" : "released";
  escrow.resolvedAt = now;
  const remaining = (lockedQuantities.get(listing.assetId) ?? 0) - listing.quantity;
  if (remaining > 0) lockedQuantities.set(listing.assetId, remaining);
  else lockedQuantities.delete(listing.assetId);
  return true;
}

export function __seedAsset(asset: TokenizedAsset): void {
  assets.set(asset.assetId, { ...asset });
}

export function __getListing(listingId: string): MarketplaceListing | undefined {
  const listing = listings.get(listingId);
  return listing ? { ...listing } : undefined;
}

export function __getEscrow(escrowId: string): EscrowLock | undefined {
  const escrow = escrows.get(escrowId);
  return escrow ? { ...escrow } : undefined;
}

export function __getLockedQuantity(assetId: string): number {
  return lockedQuantities.get(assetId) ?? 0;
}

export function __resetMarketplace(): void {
  assets.clear();
  listings.clear();
  escrows.clear();
  lockedQuantities.clear();
}

export default router;
