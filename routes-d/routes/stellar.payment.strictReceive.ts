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

type StrictReceiveBody = {
  sourceAccount: string;
  sendAsset: AssetDescriptor;
  sourceMax: string;
  destination: string;
  destAsset: AssetDescriptor;
  destAmount: string;
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
 * POST /stellar/payment/strict-receive
 * Build an unsigned strict-receive path payment envelope.
 */
router.post(
  "/stellar/payment/strict-receive",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as StrictReceiveBody;

      if (!body.sourceAccount || typeof body.sourceAccount !== "string") {
        sendError(res, "INVALID_SOURCE", "sourceAccount is required", 400);
        return;
      }

      if (!body.sendAsset || !body.sendAsset.code) {
        sendError(res, "INVALID_SEND_ASSET", "sendAsset with code is required", 400);
        return;
      }

      if (
        !body.sourceMax ||
        typeof body.sourceMax !== "string" ||
        isNaN(Number(body.sourceMax)) ||
        Number(body.sourceMax) <= 0
      ) {
        sendError(res, "INVALID_SOURCE_MAX", "sourceMax must be a positive numeric string", 400);
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
        !body.destAmount ||
        typeof body.destAmount !== "string" ||
        isNaN(Number(body.destAmount)) ||
        Number(body.destAmount) <= 0
      ) {
        sendError(res, "INVALID_DEST_AMOUNT", "destAmount must be a positive numeric string", 400);
        return;
      }

      // sourceMax is the most the sender will spend; destAmount is the exact receive amount.
      // If sourceMax exceeds 1000× destAmount it is almost certainly a fat-finger error.
      if (Number(body.sourceMax) > Number(body.destAmount) * 1000) {
        sendError(
          res,
          "SOURCE_MAX_BREACH",
          "sourceMax exceeds a reasonable bound relative to destAmount",
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
        Operation.pathPaymentStrictReceive({
          sendAsset,
          sendMax: body.sourceMax,
          destination: body.destination,
          destAsset,
          destAmount: body.destAmount,
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
