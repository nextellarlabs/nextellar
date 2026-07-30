import { Router, Request, Response, NextFunction } from "express";
import { idempotency, IdempotencyRequest } from "../middleware/idempotency.js";
import { noCache } from "../middleware/noCache.js";

const router = Router();

/**
 * GET /:id
 * Retrieves a payment by its ID.
 */
router.get(
  "/:id",
  noCache,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      res.status(200).json({ success: true, data: { id, status: "completed" } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /
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
  "/",
  idempotency,
  noCache,
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
