import { validateStellarAddress } from '../lib/stellarAddress.js';
import type { Request, Response, NextFunction } from 'express';

/**
 * Express middleware to validate the `destination` field in the request body.
 * Responds with HTTP 400 and a field‑level error object when validation fails.
 */
export function validatePaymentAddress(req: Request, res: Response, next: NextFunction): void {
  const destination = typeof req.body?.destination === 'string' ? req.body.destination.trim() : '';
  const errors = validateStellarAddress(destination);
  if (errors.length > 0) {
    // Return the first error message; could be expanded to include all.
    res.status(400).json({ ok: false, errors: { destination: errors[0] } });
    return;
  }
  next();
}
