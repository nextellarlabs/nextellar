import { Router, Request, Response, NextFunction } from "express";
import {
  Networks,
  TransactionBuilder,
  Account,
  Operation,
  Asset,
  Memo,
} from "@stellar/stellar-sdk";
import { sendError } from "../lib/response.js";

const router = Router();

type AssetDescriptor = {
  code: string;
  issuer?: string;
};

type StrictSendBody = {
  sourceAccount: string;
  sendAsset: AssetDescriptor;
  sendAmount: string;
  destination: string;
  destAsset: AssetDescriptor;
  destMin: string;
  path?: AssetDescriptor[];
  networkPassphrase?: string;
};

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
 * POST /stellar/payment/strict-send
 * Build an unsigned strict-send path payment envelope.
 */
router.post(
  "/stellar/payment/strict-send",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as StrictSendBody;

      if (!body.sourceAccount || typeof body.sourceAccount !== "string") {
        sendError(res, "INVALID_SOURCE", "sourceAccount is required", 400);
        return;
      }

      if (!body.sendAsset || !body.sendAsset.code) {
        sendError(res, "INVALID_SEND_ASSET", "sendAsset with code is required", 400);
        return;
      }

      if (
        !body.sendAmount ||
        typeof body.sendAmount !== "string" ||
        isNaN(Number(body.sendAmount)) ||
        Number(body.sendAmount) <= 0
      ) {
        sendError(res, "INVALID_SEND_AMOUNT", "sendAmount must be a positive numeric string", 400);
        return;
      }

      if (!body.destination || typeof body.destination !== "string") {
        sendError(res, "INVALID_DESTINATION", "destination is required", 400);
        return;
      }

      if (!body.destAsset || !body.destAsset.code) {
        sendError(res, "INVALID_DEST_ASSET", "destAsset with code is required", 400);
        return;
      }

      if (
        !body.destMin ||
        typeof body.destMin !== "string" ||
        isNaN(Number(body.destMin)) ||
        Number(body.destMin) <= 0
      ) {
        sendError(res, "INVALID_DEST_MIN", "destMin must be a positive numeric string", 400);
        return;
      }

      if (Number(body.destMin) > Number(body.sendAmount) * 1000) {
        sendError(
          res,
          "SLIPPAGE_BREACH",
          "destMin exceeds a reasonable bound relative to sendAmount",
          400,
        );
        return;
      }

      let sendAsset: Asset;
      let destAsset: Asset;
      let pathAssets: Asset[];

      try {
        sendAsset = toStellarAsset(body.sendAsset);
        destAsset = toStellarAsset(body.destAsset);
        pathAssets = (body.path ?? []).map(toStellarAsset);
      } catch {
        sendError(res, "INVALID_ASSET", "One or more asset descriptors are invalid", 400);
        return;
      }

      const networkPassphrase = body.networkPassphrase ?? Networks.TESTNET;

      const source = new Account(body.sourceAccount, "0");
      const builder = new TransactionBuilder(source, {
        fee: "100",
        networkPassphrase,
      });

      builder.addOperation(
        Operation.pathPaymentStrictSend({
          sendAsset,
          sendAmount: body.sendAmount,
          destination: body.destination,
          destAsset,
          destMin: body.destMin,
          path: pathAssets,
        }),
      );

      builder.setTimeout(300);
      const tx = builder.build();

      return res.status(200).json({
        success: true,
        data: {
          envelope: tx.toEnvelope().toXDR("base64"),
          networkPassphrase,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
