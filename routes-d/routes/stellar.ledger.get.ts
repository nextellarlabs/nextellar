import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type LedgerRecord = {
  sequence: number;
  hash: string;
  closedAt: string;
  totalTransactions: number;
  totalOperations: number;
  totalPayments: number;
};

const knownLedgers = new Map<number, LedgerRecord>();
const unclosedSeqs = new Set<number>();

export function __resetLedgers(): void {
  knownLedgers.clear();
  unclosedSeqs.clear();
}

export function __addLedger(seq: number, record: LedgerRecord): void {
  knownLedgers.set(seq, record);
}

export function __setUnclosedSeq(seq: number): void {
  unclosedSeqs.add(seq);
}

router.get("/stellar/ledger/:seq", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = req.params.seq;
    const parsed = Number(raw);

    if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== raw) {
      sendError(res, "INVALID_SEQUENCE", "seq must be a positive integer", 400);
      return;
    }

    if (unclosedSeqs.has(parsed)) {
      sendError(res, "LEDGER_NOT_CLOSED", "Ledger exists but has not yet closed", 425);
      return;
    }

    const ledger = knownLedgers.get(parsed);
    if (!ledger) {
      sendError(res, "LEDGER_NOT_FOUND", "No ledger found for the given sequence number", 404);
      return;
    }

    return res.status(200).json({
      success: true,
      data: ledger,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
