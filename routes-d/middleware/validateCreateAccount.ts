// routes-d/middleware/validateCreateAccount.ts
// Validate the payload for sponsor‑funded account creation.
// Returns a 400 response on validation errors.

import type { Request, Response, NextFunction } from "express";
import { isValidStellarPublicKey } from "../lib/stellarAddress.js"; // assume helper exists

export interface CreateAccountPayload {
  destination?: string; // optional existing Stellar address to fund
  memo?: string; // optional memo string (max 28 bytes for text memo)
  initialBalance?: string; // XLM amount as a string, defaults to sponsor config value
}

export function validateCreateAccount(req: Request, res: Response, next: NextFunction) {
  const payload: CreateAccountPayload = req.body ?? {};
  const errors: string[] = [];

  if (payload.destination && !isValidStellarPublicKey(payload.destination)) {
    errors.push("Invalid destination public key – must start with 'G' and be 56 chars long");
  }

  if (payload.memo && Buffer.byteLength(payload.memo, "utf8") > 28) {
    errors.push("Memo is too long – maximum 28 UTF‑8 bytes for a text memo");
  }

  if (payload.initialBalance !== undefined) {
    const bal = Number(payload.initialBalance);
    if (Number.isNaN(bal) || bal <= 0) {
      errors.push("initialBalance must be a positive number");
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ ok: false, errors });
  }

  // attach validated payload for downstream handler
  (req as any).validatedCreateAccount = payload;
  next();
}
