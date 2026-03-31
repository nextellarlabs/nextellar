import { Router, Request, Response, NextFunction } from "express";
import { idempotency, IdempotencyRequest } from "../middleware/idempotency.js";

const router = Router();

/**
 * POST /payments
 * Processes a payment with idempotency protection.
 * Requires Idempotency-Key header (UUID).
 * Duplicate requests with the same key return cached result.
 *
 * Request headers:
 *  - Idempotency-Key: UUID (required)
 *
 * Request body:
 *  - amount: string
 *  - destination: string
 *  - asset: string
 */
router.post(
  "/payments",
  idempotency,
  async (req: IdempotencyRequest, res: Response, next: NextFunction) => {
    try {
      const { amount, destination, asset } = req.body;

      // TODO: replace with real payment provider / DB calls
      const result = await processPayment({ amount, destination, asset });

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

// ---------------------------------------------------------------------------
// Stub — swap out for your actual service layer
// ---------------------------------------------------------------------------
async function processPayment(payload: {
  amount: string;
  destination: string;
  asset: string;
}) {
  if (!payload.amount || !payload.destination) {
    throw new Error("Missing required payment fields");
  }
  return { txHash: "mock-tx-hash", ...payload };
}
