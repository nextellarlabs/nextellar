import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../utils/response.js";

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
        sendError(res, 'AMOUNT_REQUIRED', 'Amount is required', 400);
        return;
      }

      // 2. Validate it's a number and a safe integer (prevents overflow loss)
      if (
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        !Number.isSafeInteger(amount)
      ) {
        sendError(res, 'INVALID_AMOUNT', 'Invalid amount format. Must be a finite integer.', 400);
        return;
      }

      // 3. Reject negative or zero values
      if (amount <= 0) {
        sendError(res, 'INVALID_AMOUNT', 'Amount must be a positive integer greater than zero.', 400);
        return;
      }

      // 4. Cap at maximum allowed single transfer
      if (amount > MAX_TRANSFER_AMOUNT) {
        sendError(res, 'AMOUNT_EXCEEDED', `Transfer amount exceeds the maximum limit of ${MAX_TRANSFER_AMOUNT} units.`, 400);
        return;
      }

      // 5. Success - Mock processing
      res.status(200).json({
        success: true,
        message: "Transfer processed successfully",
        data: {
          amount,
          destination,
          fee: Math.floor(amount * 0.01),
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
