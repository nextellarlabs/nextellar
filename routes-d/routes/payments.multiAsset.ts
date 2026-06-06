// POST /payments/multi-asset — send payments in non-native Stellar assets (#290).
//
// Accepts an array of payment operations (each with its own asset/amount/
// destination) and returns an unsigned transaction envelope for client signing.
// Validates every operation before building anything so the caller gets a
// complete error list in one round-trip.

import { Router, type Request, type Response } from "express";
import { validatePaymentAmount, amountErrorsToBody, type FieldError } from "../lib/amount.js";

export interface AssetSpec {
  code: string;
  issuer?: string;
}

export interface PaymentOperation {
  destination: string;
  amount: string | number;
  asset: AssetSpec;
  memo?: string;
}

export interface MultiAssetPaymentRouterOptions {
  /**
   * Build an unsigned XDR envelope from the validated operations.
   * Defaults to a deterministic stub for testing.
   */
  buildEnvelope?: (ops: ValidatedOperation[]) => string;
  /** Maximum number of operations per request. Defaults to 100. */
  maxOps?: number;
}

export interface ValidatedOperation {
  destination: string;
  amount: string;
  asset: { code: string; issuer?: string };
  memo?: string;
}

const STELLAR_ACCOUNT_RE = /^G[A-Z2-7]{55}$/;
const DEFAULT_MAX_OPS = 100;

function readString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

interface OpValidationError {
  index: number;
  errors: FieldError[];
}

export function createMultiAssetPaymentRouter(
  options: MultiAssetPaymentRouterOptions = {},
): Router {
  const router = Router();
  const maxOps = options.maxOps ?? DEFAULT_MAX_OPS;
  const buildEnvelope =
    options.buildEnvelope ??
    ((ops) =>
      `envelope_multi_${ops.map((o) => o.asset.code).join("_")}_${Date.now()}`);

  router.post("/multi-asset", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawOps = body.operations;

    if (!Array.isArray(rawOps) || rawOps.length === 0) {
      res.status(400).json({ ok: false, error: "operations must be a non-empty array" });
      return;
    }

    if (rawOps.length > maxOps) {
      res.status(400).json({
        ok: false,
        error: `too many operations: max ${maxOps}, got ${rawOps.length}`,
      });
      return;
    }

    const validatedOps: ValidatedOperation[] = [];
    const opErrors: OpValidationError[] = [];

    for (let i = 0; i < rawOps.length; i++) {
      const op = (rawOps[i] ?? {}) as Record<string, unknown>;
      const errors: FieldError[] = [];

      const destination = readString(op.destination);
      if (!destination || !STELLAR_ACCOUNT_RE.test(destination)) {
        errors.push({
          field: "amount", // reuse FieldError shape; field = "destination" conceptually
          message: `operations[${i}].destination must be a valid Stellar account (G...)`,
        });
      }

      const assetRaw = (op.asset ?? {}) as Record<string, unknown>;
      const assetCode = readString(assetRaw.code);
      const assetIssuer = readString(assetRaw.issuer) || undefined;

      const amountResult = validatePaymentAmount({
        amount: op.amount,
        asset: { code: assetCode || "XLM", issuer: assetIssuer },
      });

      if (!amountResult.ok) {
        for (const e of amountResult.errors) {
          errors.push({
            field: e.field,
            message: `operations[${i}].${e.message}`,
          });
        }
      }

      if (errors.length > 0) {
        opErrors.push({ index: i, errors });
      } else if (amountResult.ok) {
        validatedOps.push({
          destination,
          amount: amountResult.amount,
          asset: amountResult.asset,
          memo: readString(op.memo) || undefined,
        });
      }
    }

    if (opErrors.length > 0) {
      res.status(400).json({ ok: false, operationErrors: opErrors });
      return;
    }

    const envelope = buildEnvelope(validatedOps);

    res.status(200).json({
      ok: true,
      envelope,
      operationCount: validatedOps.length,
      operations: validatedOps,
    });
  });

  return router;
}
