import { Router, Request, Response, NextFunction } from "express";

const router = Router();

/**
 * Middleware that enforces Content-Type: application/json on requests
 * with a body. Returns 415 Unsupported Media Type for anything else.
 */
function requireJsonContentType(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const contentType = req.headers["content-type"];

  if (!contentType || !contentType.includes("application/json")) {
    res.status(415).json({
      success: false,
      message:
        "Unsupported Media Type. Content-Type must be application/json.",
    });
    return;
  }

  next();
}

/**
 * POST /transactions
 * Processes a transaction. Rejects non-JSON content types with 415.
 */
router.post(
  "/transactions",
  requireJsonContentType,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { amount, destination, memo } = req.body;

      const result = await processTransaction({ amount, destination, memo });

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

// ---------------------------------------------------------------------------
// Stub - swap out for your actual service / DB layer
// ---------------------------------------------------------------------------
export async function processTransaction(payload: {
  amount: string;
  destination: string;
  memo?: string;
}) {
  if (!payload.amount || !payload.destination) {
    throw new Error("Missing required transaction fields");
  }
  return { txHash: "mock-tx-hash", ...payload };
}
