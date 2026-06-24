import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";
import * as StellarSDK from "@stellar/stellar-sdk";

const router = Router();

type Asset = {
  code: string;
  issuer?: string;
};

type CreateOfferBody = {
  sellingAsset: Asset;
  buyingAsset: Asset;
  amount: string;
  price: string;
  offerType: "sell" | "buy";
  accountId: string;
};

/**
 * POST /stellar/offer/create
 * Create a manage_sell_offer or manage_buy_offer envelope.
 */
router.post(
  "/stellar/offer/create",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as CreateOfferBody;

      // Validate sellingAsset
      if (!body.sellingAsset || typeof body.sellingAsset !== "object") {
        sendError(res, "INVALID_SELLING_ASSET", "sellingAsset is required and must be an object", 400);
        return;
      }

      if (!body.sellingAsset.code || typeof body.sellingAsset.code !== "string") {
        sendError(
          res,
          "INVALID_SELLING_ASSET_CODE",
          "sellingAsset.code is required and must be a string",
          400,
        );
        return;
      }

      // Validate buyingAsset
      if (!body.buyingAsset || typeof body.buyingAsset !== "object") {
        sendError(res, "INVALID_BUYING_ASSET", "buyingAsset is required and must be an object", 400);
        return;
      }

      if (!body.buyingAsset.code || typeof body.buyingAsset.code !== "string") {
        sendError(
          res,
          "INVALID_BUYING_ASSET_CODE",
          "buyingAsset.code is required and must be a string",
          400,
        );
        return;
      }

      // Validate amount
      if (!body.amount || typeof body.amount !== "string") {
        sendError(res, "INVALID_AMOUNT", "amount is required and must be a string", 400);
        return;
      }

      const amountNum = parseFloat(body.amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        sendError(res, "INVALID_AMOUNT", "amount must be a positive number", 400);
        return;
      }

      // Validate price
      if (!body.price || typeof body.price !== "string") {
        sendError(res, "INVALID_PRICE", "price is required and must be a string", 400);
        return;
      }

      const priceNum = parseFloat(body.price);
      if (isNaN(priceNum) || priceNum <= 0) {
        sendError(res, "INVALID_PRICE", "price must be a positive number", 400);
        return;
      }

      // Validate offerType
      if (!body.offerType || (body.offerType !== "sell" && body.offerType !== "buy")) {
        sendError(res, "INVALID_OFFER_TYPE", "offerType must be 'sell' or 'buy'", 400);
        return;
      }

      // Validate accountId
      if (!body.accountId || typeof body.accountId !== "string") {
        sendError(res, "INVALID_ACCOUNT_ID", "accountId is required and must be a string", 400);
        return;
      }

      // Validate Stellar account ID format
      if (!body.accountId.startsWith("G") || body.accountId.length !== 56) {
        sendError(res, "INVALID_ACCOUNT_ID", "accountId must be a valid Stellar public key (56 chars starting with G)", 400);
        return;
      }

      // Check if selling and buying assets are the same
      const sellingAssetCode = body.sellingAsset.code;
      const buyingAssetCode = body.buyingAsset.code;

      if (sellingAssetCode === buyingAssetCode && body.sellingAsset.issuer === body.buyingAsset.issuer) {
        sendError(res, "INVALID_ASSET_PAIR", "Selling and buying assets cannot be the same", 400);
        return;
      }

      // Build the transaction
      const envelope = {
        success: true,
        data: {
          offerType: body.offerType,
          sellingAsset: body.sellingAsset,
          buyingAsset: body.buyingAsset,
          amount: body.amount,
          price: body.price,
          accountId: body.accountId,
          envelope: `Unsigned transaction envelope for ${body.offerType} offer (${body.amount} ${body.sellingAsset.code} at ${body.price})`,
        },
      };

      return res.status(201).json(envelope);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
