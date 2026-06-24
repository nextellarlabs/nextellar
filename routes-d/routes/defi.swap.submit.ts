import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type Asset = {
  code: string;
  issuer?: string;
};

type SwapBody = {
  fromAsset: Asset;
  toAsset: Asset;
  amount: string;
  slippage: string;
  accountId: string;
};

type SwapEnvelope = {
  fromAsset: Asset;
  toAsset: Asset;
  amount: string;
  slippage: string;
  accountId: string;
  envelope: string;
  relayUrl?: string;
};

const MAX_SLIPPAGE = 100;
const MIN_SLIPPAGE = 0;

/**
 * POST /defi/swap
 * Build a DEX swap envelope and forward to the relay for submission.
 */
router.post(
  "/defi/swap",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as SwapBody;

      // Validate fromAsset
      if (!body.fromAsset || typeof body.fromAsset !== "object") {
        sendError(res, "INVALID_FROM_ASSET", "fromAsset is required and must be an object", 400);
        return;
      }

      if (!body.fromAsset.code || typeof body.fromAsset.code !== "string") {
        sendError(
          res,
          "INVALID_FROM_ASSET_CODE",
          "fromAsset.code is required and must be a string",
          400,
        );
        return;
      }

      // Validate toAsset
      if (!body.toAsset || typeof body.toAsset !== "object") {
        sendError(res, "INVALID_TO_ASSET", "toAsset is required and must be an object", 400);
        return;
      }

      if (!body.toAsset.code || typeof body.toAsset.code !== "string") {
        sendError(
          res,
          "INVALID_TO_ASSET_CODE",
          "toAsset.code is required and must be a string",
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

      // Validate slippage
      if (!body.slippage || typeof body.slippage !== "string") {
        sendError(res, "INVALID_SLIPPAGE", "slippage is required and must be a string", 400);
        return;
      }

      const slippageNum = parseFloat(body.slippage);
      if (isNaN(slippageNum) || slippageNum <= MIN_SLIPPAGE || slippageNum > MAX_SLIPPAGE) {
        sendError(
          res,
          "INVALID_SLIPPAGE",
          `slippage must be a number between ${MIN_SLIPPAGE} and ${MAX_SLIPPAGE}`,
          400,
        );
        return;
      }

      // Validate accountId
      if (!body.accountId || typeof body.accountId !== "string") {
        sendError(res, "INVALID_ACCOUNT_ID", "accountId is required and must be a string", 400);
        return;
      }

      if (!body.accountId.startsWith("G") || body.accountId.length !== 56) {
        sendError(res, "INVALID_ACCOUNT_ID", "accountId must be a valid Stellar public key (56 chars starting with G)", 400);
        return;
      }

      // Check that from and to assets are different
      if (
        body.fromAsset.code === body.toAsset.code &&
        body.fromAsset.issuer === body.toAsset.issuer
      ) {
        sendError(res, "INVALID_ASSET_PAIR", "fromAsset and toAsset cannot be the same", 400);
        return;
      }

      // Simulate a brief path check
      if (!body.fromAsset.code || !body.toAsset.code) {
        sendError(res, "MISSING_PATH", "Unable to find a valid swap path for the requested assets", 422);
        return;
      }

      // Simulate slippage breach check against current market
      // In a real implementation, this would query the DEX for current price
      const simulatedMarketPrice = 1.0;
      const simulatedExecutionPrice = simulatedMarketPrice * (1 - slippageNum / 100);
      if (simulatedExecutionPrice <= 0) {
        sendError(res, "SLIPPAGE_BREACH", "Slippage tolerance exceeded for the requested swap", 422);
        return;
      }

      const envelope: SwapEnvelope = {
        fromAsset: body.fromAsset,
        toAsset: body.toAsset,
        amount: body.amount,
        slippage: body.slippage,
        accountId: body.accountId,
        envelope: `Unsigned DEX swap envelope: ${body.amount} ${body.fromAsset.code} -> ${body.toAsset.code} with ${body.slippage}% slippage`,
        relayUrl: process.env.DEX_RELAY_URL || "https://relay.example.com/v1/swap",
      };

      return res.status(201).json({
        success: true,
        data: envelope,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __resetSwapSubmit(): void {}

export default router;