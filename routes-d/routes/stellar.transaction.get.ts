import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

/**
 * Stellar transaction hash: exactly 64 lowercase hex characters.
 * This matches the SHA-256 hex digest used on the Stellar network.
 */
const TX_HASH_RE = /^[0-9a-fA-F]{64}$/;

type Transaction = {
  hash: string;
  ledger: number;
  createdAt: string;
  sourceAccount: string;
  fee: string;
  operationCount: number;
  resultCode: string;
  envelope: string;
  memo: string | null;
};

// In-memory store keyed by lowercase transaction hash
const transactionStore = new Map<string, Transaction>();

// Seed a deterministic known transaction for integration tests
const KNOWN_HASH =
  "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889";

transactionStore.set(KNOWN_HASH, {
  hash: KNOWN_HASH,
  ledger: 100_000,
  createdAt: "2024-06-01T12:00:00Z",
  sourceAccount: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  fee: "100",
  operationCount: 1,
  resultCode: "txSUCCESS",
  envelope: "AAAAAQ==",
  memo: null,
});

/**
 * GET /stellar/transaction/:hash
 * Fetch a single Stellar transaction by its hash.
 */
router.get(
  "/stellar/transaction/:hash",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { hash } = req.params;

      // Validate: must be exactly 64 hex characters
      if (!hash || !TX_HASH_RE.test(hash)) {
        sendError(
          res,
          "INVALID_TX_HASH",
          "Transaction hash must be a 64-character hexadecimal string",
          400,
        );
        return;
      }

      const normalizedHash = hash.toLowerCase();
      const tx = transactionStore.get(normalizedHash);

      if (!tx) {
        sendError(
          res,
          "TRANSACTION_NOT_FOUND",
          `No transaction found for hash: ${normalizedHash}`,
          404,
        );
        return;
      }

      return res.status(200).json({
        success: true,
        data: tx,
      });
    } catch (err) {
      return next(err);
    }
  },
);

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Reset the store to only the default seed (used in beforeEach). */
export function __resetTransactions(): void {
  transactionStore.clear();
  transactionStore.set(KNOWN_HASH, {
    hash: KNOWN_HASH,
    ledger: 100_000,
    createdAt: "2024-06-01T12:00:00Z",
    sourceAccount: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    fee: "100",
    operationCount: 1,
    resultCode: "txSUCCESS",
    envelope: "AAAAAQ==",
    memo: null,
  });
}

/** Add an arbitrary transaction to the store. */
export function __seedTransaction(tx: Transaction): void {
  transactionStore.set(tx.hash.toLowerCase(), tx);
}

export { KNOWN_HASH };

export default router;
