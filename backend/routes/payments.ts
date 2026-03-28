import { Router, Request, Response, NextFunction } from "express";

const router = Router();

/**
 * POST /payments
 * Processes a payment. Wraps all async logic in try/catch so any
 * rejection (provider timeout, DB write failure, etc.) is forwarded
 * to the global error middleware via next(err) instead of crashing.
 */
router.post(
  "/payments",
  async (req: Request, res: Response, next: NextFunction) => {
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
