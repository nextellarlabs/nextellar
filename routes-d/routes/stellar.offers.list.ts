import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type AssetDescriptor = {
  code: string;
  issuer?: string;
};

type Offer = {
  id: string;
  account: string;
  selling: AssetDescriptor;
  buying: AssetDescriptor;
  amount: string;
  price: string;
  createdAt: string;
};

type OffersPage = {
  offers: Offer[];
  cursor: string | null;
  hasMore: boolean;
};

// In-memory storage keyed by account id
const offersByAccount = new Map<string, Offer[]>();

const STELLAR_ACCOUNT_REGEX = /^G[A-Z2-7]{55}$/;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function assetMatches(offer: AssetDescriptor, filter: string): boolean {
  return offer.code === filter;
}

/**
 * GET /stellar/offers/:account
 * List open DEX offers for a Stellar account.
 */
router.get(
  "/stellar/offers/:account",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { account } = req.params;

      if (!account || !STELLAR_ACCOUNT_REGEX.test(account)) {
        sendError(
          res,
          "INVALID_ACCOUNT",
          "A valid Stellar account ID (G…) is required",
          400,
        );
        return;
      }

      const allOffers = offersByAccount.get(account) ?? [];

      // Optional asset filters
      const sellingFilter = typeof req.query.selling === "string" ? req.query.selling : null;
      const buyingFilter = typeof req.query.buying === "string" ? req.query.buying : null;

      let filtered = allOffers;
      if (sellingFilter) {
        filtered = filtered.filter((o) => assetMatches(o.selling, sellingFilter));
      }
      if (buyingFilter) {
        filtered = filtered.filter((o) => assetMatches(o.buying, buyingFilter));
      }

      // Pagination
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
      const limitParam = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : DEFAULT_LIMIT;
      const limit = Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(limitParam, MAX_LIMIT)
        : DEFAULT_LIMIT;

      let startIndex = 0;
      if (cursor) {
        const cursorIndex = filtered.findIndex((o) => o.id === cursor);
        if (cursorIndex === -1) {
          sendError(res, "INVALID_CURSOR", "Cursor does not match any offer", 400);
          return;
        }
        startIndex = cursorIndex + 1;
      }

      const page = filtered.slice(startIndex, startIndex + limit);
      const hasMore = startIndex + limit < filtered.length;

      const result: OffersPage = {
        offers: page,
        cursor: hasMore ? page[page.length - 1].id : null,
        hasMore,
      };

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return next(err);
    }
  },
);

export function __getOffersByAccount(): Map<string, Offer[]> {
  return offersByAccount;
}

export function __resetOffers(): void {
  offersByAccount.clear();
}

export function __seedOffers(account: string, offers: Offer[]): void {
  offersByAccount.set(account, offers);
}

export default router;
