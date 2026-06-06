// POST /stellar/tx/feebump - wraps a user-signed inner transaction in a
// server-paid Stellar fee-bump transaction.

import { Router, type Request, type Response } from "express";
import {
  FeeBumpTransaction,
  Keypair,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

export interface FeeBumpRequest {
  /** Base64/XDR encoded user-signed inner transaction envelope. */
  innerEnvelope: string;
  /** Fee-bump fee in stroops. Must not exceed the configured cap. */
  bumpFee: string;
}

export interface FeeBumpBuilder {
  build(input: {
    feeSource: string;
    fee: string;
    innerTransaction: Transaction;
    networkPassphrase: string;
  }): FeeBumpTransaction;
}

export interface FeeBumpSigner {
  publicKey: string;
  sign(transaction: FeeBumpTransaction): void | Promise<void>;
}

export interface FeeBumpRouterOptions {
  signer: FeeBumpSigner;
  networkPassphrase: string;
  maxBumpFee: string | number | bigint;
  builder?: FeeBumpBuilder;
}

export class FeeBumpValidationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "FeeBumpValidationError";
    this.status = status;
    this.code = code;
  }
}

function readBody(body: unknown): FeeBumpRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const innerEnvelope = typeof b.innerEnvelope === "string" ? b.innerEnvelope.trim() : "";
  const bumpFee = typeof b.bumpFee === "string" || typeof b.bumpFee === "number" || typeof b.bumpFee === "bigint"
    ? String(b.bumpFee).trim()
    : "";

  if (!innerEnvelope || !bumpFee) return null;
  return { innerEnvelope, bumpFee };
}

function parsePositiveInteger(value: string | number | bigint, label: string): bigint {
  const raw = String(value).trim();
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new FeeBumpValidationError(400, "invalid_fee", `${label} must be a positive integer stroop amount`);
  }
  return BigInt(raw);
}

export function validateBumpFee(
  bumpFee: string | number | bigint,
  maxBumpFee: string | number | bigint,
): string {
  const requested = parsePositiveInteger(bumpFee, "bumpFee");
  const maximum = parsePositiveInteger(maxBumpFee, "maxBumpFee");

  if (requested > maximum) {
    throw new FeeBumpValidationError(
      422,
      "fee_cap_exceeded",
      `bumpFee exceeds configured maximum of ${maximum.toString()} stroops`,
    );
  }

  return requested.toString();
}

export function parseInnerTransaction(
  innerEnvelope: string,
  networkPassphrase: string,
): Transaction {
  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(innerEnvelope, networkPassphrase);
  } catch {
    throw new FeeBumpValidationError(400, "malformed_inner", "innerEnvelope is not a valid transaction envelope");
  }

  if (parsed instanceof FeeBumpTransaction) {
    throw new FeeBumpValidationError(400, "malformed_inner", "innerEnvelope must not already be a fee-bump transaction");
  }

  if (!Array.isArray(parsed.signatures) || parsed.signatures.length === 0) {
    throw new FeeBumpValidationError(400, "unsigned_inner", "innerEnvelope must include at least one user signature");
  }

  return parsed;
}

export function loadFeeBumpSignerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): FeeBumpSigner {
  const secret = env.STELLAR_FEE_BUMP_SECRET;
  if (!secret) {
    throw new Error("STELLAR_FEE_BUMP_SECRET must be set to enable fee bumping");
  }

  const keypair = Keypair.fromSecret(secret);
  return {
    publicKey: keypair.publicKey(),
    sign: (transaction) => {
      transaction.sign(keypair);
    },
  };
}

export function readMaxBumpFeeFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.STELLAR_FEE_BUMP_MAX_FEE ?? "1000000";
  validateBumpFee(configured, configured);
  return configured;
}

export function createFeeBumpRouter(options: FeeBumpRouterOptions): Router {
  const maxBumpFee = validateBumpFee(options.maxBumpFee, options.maxBumpFee);
  const builder: FeeBumpBuilder = options.builder ?? {
    build: ({ feeSource, fee, innerTransaction, networkPassphrase }) =>
      TransactionBuilder.buildFeeBumpTransaction(
        feeSource,
        fee,
        innerTransaction,
        networkPassphrase,
      ),
  };

  const router = Router();

  router.post("/feebump", async (req: Request, res: Response) => {
    const body = readBody(req.body);
    if (!body) {
      res.status(400).json({
        ok: false,
        code: "invalid_request",
        error: "innerEnvelope and bumpFee are required",
      });
      return;
    }

    let bumpFee: string;
    let innerTransaction: Transaction;
    try {
      bumpFee = validateBumpFee(body.bumpFee, maxBumpFee);
      innerTransaction = parseInnerTransaction(body.innerEnvelope, options.networkPassphrase);
    } catch (error) {
      if (error instanceof FeeBumpValidationError) {
        res.status(error.status).json({ ok: false, code: error.code, error: error.message });
        return;
      }
      throw error;
    }

    let feeBump: FeeBumpTransaction;
    try {
      feeBump = builder.build({
        feeSource: options.signer.publicKey,
        fee: bumpFee,
        innerTransaction,
        networkPassphrase: options.networkPassphrase,
      });
      await options.signer.sign(feeBump);
    } catch {
      res.status(500).json({ ok: false, code: "fee_bump_failed", error: "failed to build fee-bump transaction" });
      return;
    }

    res.status(200).json({
      ok: true,
      feeSource: options.signer.publicKey,
      bumpFee,
      envelope: feeBump.toXDR(),
    });
  });

  return router;
}

