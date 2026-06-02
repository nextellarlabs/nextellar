import { Router, type Request, type Response, type RequestHandler } from "express";
import { validatePaymentAmount, amountErrorsToBody } from "../lib/amount.js";
import { idempotency, type IdempotencyOptions } from "../middleware/idempotency.js";
import { validatePaymentAddress } from '../middleware/validatePaymentAddress.js';


export interface PaymentSendRouterOptions {
  buildEnvelope?: (params: {
    destination: string;
    amount: string;
    assetCode: string;
    assetIssuer?: string;
    memo?: string;
  }) => string;
  /** Idempotency middleware options. Pass `false` to disable entirely. */
  idempotencyOptions?: IdempotencyOptions | false;
}

export function createPaymentSendRouter(options: PaymentSendRouterOptions = {}): Router {
  const router = Router();
  const buildEnvelope =
    options.buildEnvelope ??
    ((params) =>
      `envelope_payment_${params.assetCode}_${params.amount}_${Date.now()}`);

  const idempotencyMiddleware: RequestHandler[] =
    options.idempotencyOptions === false
      ? []
      : [idempotency(options.idempotencyOptions ?? {})];

  router.post("/send", ...idempotencyMiddleware, validatePaymentAddress, (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const destination = (typeof body.destination === "string" ? body.destination.trim() : "");
    
    const assetCode = (typeof body.assetCode === "string" ? body.assetCode.trim() : "") || "XLM";
    const assetIssuer = (typeof body.assetIssuer === "string" ? body.assetIssuer.trim() : "") || undefined;
    const memo = (typeof body.memo === "string" ? body.memo.trim() : "") || undefined;

    const amountResult = validatePaymentAmount({
      amount: body.amount,
      asset: { code: assetCode, issuer: assetIssuer },
    });
    if (!amountResult.ok) {
      res.status(400).json({ ok: false, ...amountErrorsToBody(amountResult.errors) });
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
