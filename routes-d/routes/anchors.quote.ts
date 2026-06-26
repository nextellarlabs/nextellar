import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type Asset = {
  code: string;
  issuer?: string;
};

type QuoteBody = {
  sourceAsset: Asset;
  destinationAsset: Asset;
  amount: string;
};

type AnchorQuoteResponse = {
  quoteId: string;
  anchorQuote: Record<string, unknown>;
  sourceAsset: Asset;
  destinationAsset: Asset;
  amount: string;
};

type QuoteResult = {
  quoteId: string;
  sourceAsset: Asset;
  destinationAsset: Asset;
  amount: string;
  price: string;
  expiresAt: string;
};

const knownAnchors = new Map<string, { multiplier: number; fee: string }>();
knownAnchors.set("anchor-circle", { multiplier: 0.995, fee: "0.50" });
knownAnchors.set("anchor-stronghold", { multiplier: 1.002, fee: "1.00" });

let quoteCounter = 1;
let anchorCallSuccess: boolean | undefined = undefined;

export function __resetQuoteState(): void {
  knownAnchors.clear();
  knownAnchors.set("anchor-circle", { multiplier: 0.995, fee: "0.50" });
  knownAnchors.set("anchor-stronghold", { multiplier: 1.002, fee: "1.00" });
  quoteCounter = 1;
}

export function __registerAnchor(id: string, config: { multiplier: number; fee: string }): void {
  knownAnchors.set(id, config);
}

export function __setAnchorCallSuccess(success: boolean | undefined): void {
  anchorCallSuccess = success;
}

function generateQuoteId(): string {
  return `quote-${String(quoteCounter++)}`;
}

function fetchAnchorQuote(
  anchorId: string,
  body: QuoteBody,
): { quote: Record<string, unknown>; expiresAt: string } | null {
  if (anchorCallSuccess === false) {
    return null;
  }

  const anchor = knownAnchors.get(anchorId);
  if (!anchor) {
    return null;
  }

  const amount = parseFloat(body.amount);
  const outputAmount = (amount * anchor.multiplier).toFixed(7);

  return {
    quote: {
      price: (amount * anchor.multiplier) / amount,
      fee: anchor.fee,
      amountInbound: body.amount,
      amountOutbound: outputAmount,
    },
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  };
}

router.post(
  "/anchors/:id/quote",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const body = req.body as QuoteBody;

      if (!id || typeof id !== "string" || id.trim() === "") {
        sendError(res, "INVALID_ANCHOR_ID", "anchor id is required", 400);
        return;
      }

      const anchorId = id.trim();

      if (!body.sourceAsset || typeof body.sourceAsset !== "object") {
        sendError(res, "INVALID_SOURCE_ASSET", "sourceAsset is required and must be an object", 400);
        return;
      }

      if (!body.sourceAsset.code || typeof body.sourceAsset.code !== "string") {
        sendError(res, "INVALID_SOURCE_ASSET", "sourceAsset.code is required and must be a string", 400);
        return;
      }

      if (!body.destinationAsset || typeof body.destinationAsset !== "object") {
        sendError(res, "INVALID_DESTINATION_ASSET", "destinationAsset is required and must be an object", 400);
        return;
      }

      if (!body.destinationAsset.code || typeof body.destinationAsset.code !== "string") {
        sendError(res, "INVALID_DESTINATION_ASSET", "destinationAsset.code is required and must be a string", 400);
        return;
      }

      if (!body.amount || typeof body.amount !== "string") {
        sendError(res, "INVALID_AMOUNT", "amount is required and must be a string", 400);
        return;
      }

      const amountNum = parseFloat(body.amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        sendError(res, "INVALID_AMOUNT", "amount must be a positive number", 400);
        return;
      }

      const result = fetchAnchorQuote(anchorId, body);

      if (!result) {
        sendError(res, "ANCHOR_ERROR", "Failed to fetch quote from anchor", 502);
        return;
      }

      const quote: QuoteResult = {
        quoteId: generateQuoteId(),
        sourceAsset: body.sourceAsset,
        destinationAsset: body.destinationAsset,
        amount: body.amount,
        price: result.quote.amountOutbound as string,
        expiresAt: result.expiresAt,
      };

      return res.status(200).json({
        success: true,
        data: {
          quoteId: quote.quoteId,
          anchorQuote: result.quote,
          ...quote,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;