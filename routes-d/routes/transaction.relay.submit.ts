import { Router, type NextFunction, type Request, type Response } from "express";
import {
  reserveSequence,
  releaseSequence,
  SequenceReservationError,
  withSequenceReservation,
} from "../lib/sequencePool.js";

const router = Router();

export const relaySubmitDeps = {
  async submitTransaction(payload: {
    accountId: string;
    sequence: string;
    transaction: string;
  }): Promise<{ transactionHash: string; submittedAt: number }> {
    return {
      transactionHash: `mock-${payload.accountId}-${payload.sequence}`,
      submittedAt: Date.now(),
    };
  },
};

function readString(body: Record<string, unknown> | undefined, key: string): string {
  return typeof body?.[key] === "string" ? body[key].trim() : "";
}

router.post(
  "/transactions/relay/submit",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const accountId = readString(req.body, "accountId");
      const sequence = typeof req.body?.sequence === "string" || typeof req.body?.sequence === "number" || typeof req.body?.sequence === "bigint"
        ? req.body.sequence
        : "";
      const transaction = readString(req.body, "transaction");

      if (!accountId || !transaction || sequence === "") {
        res.status(400).json({ error: "accountId, sequence, and transaction are required" });
        return;
      }

      const result = await withSequenceReservation(
        accountId,
        sequence,
        async (reservation) => {
          const submission = await relaySubmitDeps.submitTransaction({
            accountId,
            sequence: reservation.sequence.toString(),
            transaction,
          });

          return {
            reservationId: reservation.reservationId,
            sequence: reservation.sequence.toString(),
            ...submission,
          };
        },
      );

      res.status(202).json({
        success: true,
        data: result,
      });
    } catch (error) {
      if (error instanceof SequenceReservationError) {
        res.status(409).json({
          error: "sequence_reserved",
          message: error.message,
          accountId: error.accountId,
          sequence: error.sequence.toString(),
          expiresAt: error.expiresAt,
        });
        return;
      }

      next(error);
    }
  },
);

export default router;

export const reserveRelaySequence = reserveSequence;
export const releaseRelaySequence = releaseSequence;
