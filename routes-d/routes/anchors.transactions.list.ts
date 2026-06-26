import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type AnchorTransactionStatus = "pending" | "completed" | "failed" | "refunded";

type AnchorTransaction = {
  id: string;
  userId: string;
  anchorId: string;
  status: AnchorTransactionStatus;
  amount: string;
  currency: string;
  type: "deposit" | "withdrawal";
  startedAt: string;
  completedAt?: string;
};

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const transactionStore = new Map<string, AnchorTransaction[]>();
transactionStore.set("user-001", [
  {
    id: "tx-001",
    userId: "user-001",
    anchorId: "anchor-circle",
    status: "completed",
    amount: "100.00",
    currency: "USDC",
    type: "deposit",
    startedAt: "2024-06-01T10:00:00Z",
    completedAt: "2024-06-01T10:05:00Z",
  },
  {
    id: "tx-002",
    userId: "user-001",
    anchorId: "anchor-stronghold",
    status: "pending",
    amount: "250.00",
    currency: "SHx",
    type: "withdrawal",
    startedAt: "2024-06-02T14:30:00Z",
  },
]);

transactionStore.set("user-002", [
  {
    id: "tx-003",
    userId: "user-002",
    anchorId: "anchor-circle",
    status: "failed",
    amount: "50.00",
    currency: "USDC",
    type: "deposit",
    startedAt: "2024-06-03T08:00:00Z",
  },
]);

export function __resetTransactions(): void {
  transactionStore.clear();
  transactionStore.set("user-001", [
    {
      id: "tx-001",
      userId: "user-001",
      anchorId: "anchor-circle",
      status: "completed",
      amount: "100.00",
      currency: "USDC",
      type: "deposit",
      startedAt: "2024-06-01T10:00:00Z",
      completedAt: "2024-06-01T10:05:00Z",
    },
    {
      id: "tx-002",
      userId: "user-001",
      anchorId: "anchor-stronghold",
      status: "pending",
      amount: "250.00",
      currency: "SHx",
      type: "withdrawal",
      startedAt: "2024-06-02T14:30:00Z",
    },
  ]);
  transactionStore.set("user-002", [
    {
      id: "tx-003",
      userId: "user-002",
      anchorId: "anchor-circle",
      status: "failed",
      amount: "50.00",
      currency: "USDC",
      type: "deposit",
      startedAt: "2024-06-03T08:00:00Z",
    },
  ]);
}

export function __seedTransactions(userId: string, transactions: AnchorTransaction[]): void {
  transactionStore.set(userId, transactions);
}

router.get(
  "/anchors/transactions",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers["x-user-id"] as string | undefined;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
        return;
      }

      const page = req.query.page !== undefined ? parseInt(req.query.page as string, 10) : DEFAULT_PAGE;
      const limit = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : DEFAULT_LIMIT;
      const anchorId = req.query.anchor as string | undefined;
      const status = req.query.status as string | undefined;

      if (isNaN(page) || page < 1 || isNaN(limit) || limit < 1 || limit > MAX_LIMIT) {
        sendError(res, "INVALID_PAGINATION", "page must be >= 1 and limit must be between 1 and 100", 400);
        return;
      }

      const validStatuses: AnchorTransactionStatus[] = ["pending", "completed", "failed", "refunded"];
      if (status !== undefined && !validStatuses.includes(status as AnchorTransactionStatus)) {
        sendError(
          res,
          "INVALID_STATUS",
          `status must be one of: ${validStatuses.join(", ")}`,
          400,
        );
        return;
      }

      const allTransactions = transactionStore.get(userId) ?? [];

      let filtered = [...allTransactions];

      if (anchorId) {
        filtered = filtered.filter((tx) => tx.anchorId === anchorId);
      }

      if (status) {
        filtered = filtered.filter((tx) => tx.status === status);
      }

      filtered.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

      const offset = (page - 1) * limit;
      const paginated = filtered.slice(offset, offset + limit);

      return res.status(200).json({
        success: true,
        data: paginated,
        pagination: {
          page,
          limit,
          total: filtered.length,
          totalPages: Math.ceil(filtered.length / limit) || 1,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;