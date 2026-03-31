import { Router, Request, Response, NextFunction } from "express";

const router = Router();

const MAX_TRANSFER_AMOUNT = 1_000_000; // Minor units

/**
 * POST /transfer
 * Processes a transfer. Validates and caps the transfer amount.
 */
router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { amount, destination } = req.body;

      // 1. Check if amount is provided
      if (amount === undefined || amount === null) {
        res.status(400).json({ error: "Amount is required" });
        return;
      }

      // 2. Validate it's a number and a safe integer (prevents overflow loss)
      // Note: We use raw check to catch NaN, Infinity, etc.
      const rawAmount = Number(amount);

      if (
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        !Number.isSafeInteger(amount)
      ) {
        res.status(400).json({ 
          error: "Invalid amount format. Must be a finite integer." 
        });
        return;
      }

      // 3. Reject negative or zero values
      if (amount <= 0) {
        res.status(400).json({ 
          error: "Amount must be a positive integer greater than zero." 
        });
        return;
      }

      // 4. Cap at maximum allowed single transfer
      if (amount > MAX_TRANSFER_AMOUNT) {
        res.status(400).json({ 
          error: `Transfer amount exceeds the maximum limit of ${MAX_TRANSFER_AMOUNT} units.` 
        });
        return;
      }

      // 5. Success - Mock processing
      // At this point 'amount' is a safe, positive integer within range.
      res.status(200).json({
        success: true,
        message: "Transfer processed successfully",
        data: {
          amount, // strictly integer
          destination,
          fee: Math.floor(amount * 0.01) // simple integer fee (example of integer arithmetic)
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
