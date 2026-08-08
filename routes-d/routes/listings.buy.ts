import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";
import { emitSettlementWebhook } from "../lib/webhook.js";

const router = Router();

/**
 * In‑memory data stores – used only for this module and its tests.
 */
type Listing = {
  id: string;
  price: number; // in base currency units
  seller: string; // userId of the seller
  escrowAccount: string; // placeholder for a locked asset account
  active: boolean;
  buyerId?: string;
  soldAt?: string;
};

/**
 * Simple balance store – maps a userId to an available numeric balance.
 */
const listings = new Map<string, Listing>();
const balances = new Map<string, number>();

/**
 * Test helpers – exported for the test suite to manipulate the in‑memory state.
 */
export function __resetData(): void {
  listings.clear();
  balances.clear();
}

export function __seedListing(listing: Listing): void {
  listings.set(listing.id, { ...listing });
}

export function __seedBalance(userId: string, amount: number): void {
  balances.set(userId, amount);
}

export function __getListing(id: string): Listing | undefined {
  return listings.get(id);
}

/**
 * POST /listings/:id/buy
 *
 * Body: { buyerId: string }
 * Headers:
 *   - x-buyer-id: the authenticated buyer (required)
 *
 * The route verifies the listing is active, the buyer has sufficient funds,
 * performs an atomic purchase (debit buyer, credit seller, transfer asset, mark
 * the listing as sold) and finally emits a settlement webhook.
 */
router.post(
  "/listings/:id/buy",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const listingId = req.params.id?.trim();
      if (!listingId) {
        sendError(res, "INVALID_LISTING_ID", "listingId is required", 400);
        return;
      }

      const { buyerId } = req.body as { buyerId?: string };
      if (!buyerId || typeof buyerId !== "string" || !buyerId.trim()) {
        sendError(res, "INVALID_BUYER_ID", "buyerId is required", 400);
        return;
      }
      const callerBuyerId = req.headers["x-buyer-id"] as string | undefined;
      if (!callerBuyerId) {
        sendError(res, "MISSING_AUTH", "x-buyer-id header is required", 401);
        return;
      }
      if (callerBuyerId !== buyerId) {
        sendError(res, "UNAUTHORIZED_BUYER", "buyerId does not match authenticated caller", 403);
        return;
      }

      const listing = listings.get(listingId);
      if (!listing) {
        sendError(res, "NOT_FOUND", "Listing not found", 404);
        return;
      }

      if (!listing.active) {
        sendError(res, "ALREADY_SOLD", "Listing is already sold", 409);
        return;
      }

      const buyerBalance = balances.get(buyerId) ?? 0;
      if (buyerBalance < listing.price) {
        sendError(res, "INSUFFICIENT_FUNDS", "Buyer does not have enough balance", 422);
        return;
      }

      // Preserve original state for rollback on any failure.
      const originalBuyerBal = buyerBalance;
      const originalSellerBal = balances.get(listing.seller) ?? 0;
      const originalListing = { ...listing };

      // Perform atomic operations.
      try {
        // Debit buyer.
        balances.set(buyerId, originalBuyerBal - listing.price);
        // Credit seller.
        balances.set(listing.seller, originalSellerBal + listing.price);
        // Transfer asset – simulated by marking the escrow as transferred.
        listing.active = false;
        listing.buyerId = buyerId;
        listing.soldAt = new Date().toISOString();
        listings.set(listingId, listing);

        // Emit settlement webhook – failures here should not roll back the purchase.
        await emitSettlementWebhook({
          type: "listing_settled",
          listingId,
          buyerId,
          price: listing.price,
          soldAt: listing.soldAt,
        });

        return res.status(200).json({
          success: true,
          data: {
            listingId,
            buyerId,
            price: listing.price,
            soldAt: listing.soldAt,
          },
        });
      } catch (inner) {
        // Roll back state.
        balances.set(buyerId, originalBuyerBal);
        balances.set(listing.seller, originalSellerBal);
        listings.set(listingId, originalListing);
        throw inner;
      }
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
