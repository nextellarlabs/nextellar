import { Router, Request, Response, NextFunction } from "express";
import {
  Networks,
  TransactionBuilder,
  Account,
  Operation,
  Asset,
} from "@stellar/stellar-sdk";
import { sendError } from "../lib/response.js";

const router = Router();

type AssetDescriptor = {
  code: string;
  issuer?: string;
};

type StoredOffer = {
  id: string;
  accountId: string;
  sellingAsset: AssetDescriptor;
  buyingAsset: AssetDescriptor;
  price: string;
};

type CancelOfferBody = {
  offerId: string;
  accountId: string;
  networkPassphrase?: string;
};

const offers = new Map<string, StoredOffer>();

function toStellarAsset(desc: AssetDescriptor): Asset {
  if (desc.code === "XLM" && !desc.issuer) {
    return Asset.native();
  }
  if (!desc.issuer) {
    throw new Error(`Issuer is required for non-native asset ${desc.code}`);
  }
  return new Asset(desc.code, desc.issuer);
}

/**
 * POST /stellar/offer/cancel
 * Build a zero-amount ManageSellOffer envelope to cancel an existing DEX offer.
 */
router.post(
  "/stellar/offer/cancel",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as CancelOfferBody;

      if (
        !body.offerId ||
        typeof body.offerId !== "string" ||
        !/^\d+$/.test(body.offerId) ||
        body.offerId === "0"
      ) {
        sendError(res, "MISSING_OFFER_ID", "offerId must be a positive integer string", 400);
        return;
      }

      if (
        !body.accountId ||
        typeof body.accountId !== "string" ||
        !body.accountId.startsWith("G") ||
        body.accountId.length !== 56
      ) {
        sendError(
          res,
          "INVALID_ACCOUNT_ID",
          "accountId must be a valid Stellar public key (56 chars starting with G)",
          400,
        );
        return;
      }

      const stored = offers.get(body.offerId);

      if (!stored) {
        sendError(res, "OFFER_NOT_FOUND", "No offer found with the given offerId", 404);
        return;
      }

      if (stored.accountId !== body.accountId) {
        sendError(res, "OFFER_NOT_OWNED", "The offer does not belong to the calling account", 403);
        return;
      }

      let sellingAsset: Asset;
      let buyingAsset: Asset;

      try {
        sellingAsset = toStellarAsset(stored.sellingAsset);
        buyingAsset = toStellarAsset(stored.buyingAsset);
      } catch {
        sendError(res, "INVALID_ASSET", "Stored offer has invalid asset descriptors", 400);
        return;
      }

      const networkPassphrase = body.networkPassphrase ?? Networks.TESTNET;
      const source = new Account(body.accountId, "0");
      const builder = new TransactionBuilder(source, {
        fee: "100",
        networkPassphrase,
      });

      builder.addOperation(
        Operation.manageSellOffer({
          selling: sellingAsset,
          buying: buyingAsset,
          amount: "0",
          price: stored.price,
          offerId: body.offerId,
        }),
      );

      builder.setTimeout(300);
      const tx = builder.build();

      return res.status(200).json({
        success: true,
        data: {
          envelope: tx.toEnvelope().toXDR("base64"),
          networkPassphrase,
          offerId: body.offerId,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __resetOffers(): void {
  offers.clear();
}

export function __seedOffer(offer: StoredOffer): void {
  offers.set(offer.id, offer);
}

export function __getOffers(): Map<string, StoredOffer> {
  return offers;
}

export default router;
