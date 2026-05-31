import { Router, type Request, type Response } from "express";
import { validatePaymentAmount, amountErrorsToBody } from "../lib/amount.js";

export interface PaymentSendRouterOptions {
  buildEnvelope?: (params: {
    destination: string;
    amount: string;
    assetCode: string;
    assetIssuer?: string;
    memo?: string;
  }) => string;
}

function readString(body: Record<string, unknown> | undefined, key: string): string {
  return typeof body?.[key] === "string" ? body[key].trim() : "";
}

export function createPaymentSendRouter(options: PaymentSendRouterOptions = {}): Router {
  const router = Router();
  const buildEnvelope =
    options.buildEnvelope ??
    ((params) =>
      `envelope_payment_${params.assetCode}_${params.amount}_${Date.now()}`);

  router.post("/send", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const destination = readString(body, "destination");
    const assetCode = readString(body, "assetCode") || "XLM";
    const assetIssuer = readString(body, "assetIssuer") || undefined;
    const memo = readString(body, "memo") || undefined;

    const amountResult = validatePaymentAmount({
      amount: body.amount,
      asset: { code: assetCode, issuer: assetIssuer },
    });
    if (!amountResult.ok) {
      res.status(400).json({ ok: false, ...amountErrorsToBody(amountResult.errors) });
      return;
    }

    if (!destination || !destination.startsWith("G")) {
      res.status(400).json({ ok: false, error: "destination must be a Stellar account (G...)" });
      return;
    }

    const envelope = buildEnvelope({
      destination,
      amount: amountResult.amount,
      assetCode: amountResult.asset.code,
      assetIssuer: amountResult.asset.issuer,
      memo,
    });

    res.status(200).json({
      ok: true,
      envelope,
      amount: amountResult.amount,
      asset: amountResult.asset,
      destination,
    });
  });

  return router;
}
