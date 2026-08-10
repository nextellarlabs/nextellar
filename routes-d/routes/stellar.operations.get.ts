import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type Operation = {
  id: string;
  type: string;
  sourceAccount: string;
  transactionHash: string;
  createdAt: string;
  details: Record<string, unknown>;
};

type OperationsPage = {
  operations: Operation[];
  cursor: string | null;
  hasMore: boolean;
};

// In-memory storage for operations keyed by transaction hash
const operationsByTx = new Map<string, Operation[]>();

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/**
 * GET /stellar/operations/:txHash
 * List operations belonging to a Stellar transaction.
 */
router.get(
  "/stellar/operations/:txHash",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { txHash } = req.params;

      if (!txHash || typeof txHash !== "string") {
        sendError(res, "INVALID_TX_HASH", "Transaction hash is required", 400);
        return;
      }

      const ops = operationsByTx.get(txHash);

      if (!ops) {
        sendError(
          res,
          "TRANSACTION_NOT_FOUND",
          "No transaction found for the given hash",
          404,
        );
        return;
      }

      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
      const limitParam = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : DEFAULT_LIMIT;
      const limit = Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(limitParam, MAX_LIMIT)
        : DEFAULT_LIMIT;

      let startIndex = 0;
      if (cursor) {
        const cursorIndex = ops.findIndex((op) => op.id === cursor);
        if (cursorIndex === -1) {
          sendError(res, "INVALID_CURSOR", "Cursor does not match any operation", 400);
          return;
        }
        startIndex = cursorIndex + 1;
      }

      const page = ops.slice(startIndex, startIndex + limit);
      const hasMore = startIndex + limit < ops.length;

      const result: OperationsPage = {
        operations: page,
        cursor: hasMore ? page[page.length - 1].id : null,
        hasMore,
      };

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      return next(err);
    }
  },
);

export function __getOperationsByTx(): Map<string, Operation[]> {
  return operationsByTx;
}

export function __resetOperations(): void {
  operationsByTx.clear();
}

export function __seedOperations(txHash: string, ops: Operation[]): void {
  operationsByTx.set(txHash, ops);
}

export default router;
