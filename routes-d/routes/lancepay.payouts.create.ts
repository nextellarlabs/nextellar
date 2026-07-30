import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

const VALID_CURRENCIES = new Set(["USD", "EUR", "GBP", "XLM", "USDC"]);

type PayoutStatus = "pending" | "processing" | "completed" | "failed";

type Payout = {
  id: string;
  workspaceId: string;
  contractorId: string;
  destinationWallet: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  idempotencyKey?: string;
  createdAt: string;
};

type CreatePayoutBody = {
  workspaceId: string;
  contractorId: string;
  destinationWallet: string;
  amount: number;
  currency: string;
  idempotencyKey?: string;
};

// In-memory store
const payouts = new Map<string, Payout>();
const idempotencyKeys = new Map<string, string>(); // key -> payoutId
const frozenContractors = new Set<string>();

/**
 * POST /lancepay/payouts
 * Create a single LancePay payout from a workspace to a contractor.
 */
router.post(
  "/lancepay/payouts",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as CreatePayoutBody;

      if (!body.workspaceId || typeof body.workspaceId !== "string") {
        sendError(res, "INVALID_WORKSPACE_ID", "workspaceId is required", 400);
        return;
      }

      if (!body.contractorId || typeof body.contractorId !== "string") {
        sendError(res, "INVALID_CONTRACTOR_ID", "contractorId is required", 400);
        return;
      }

      if (!body.destinationWallet || typeof body.destinationWallet !== "string") {
        sendError(res, "INVALID_DESTINATION_WALLET", "destinationWallet is required", 400);
        return;
      }

      // Basic Stellar/Ethereum wallet format check (starts with G or 0x)
      const wallet = body.destinationWallet.trim();
      if (!/^(G[A-Z2-7]{55}|0x[0-9a-fA-F]{40})$/.test(wallet)) {
        sendError(
          res,
          "INVALID_DESTINATION_WALLET",
          "destinationWallet must be a valid Stellar (G...) or Ethereum (0x...) address",
          400,
        );
        return;
      }

      if (typeof body.amount !== "number" || body.amount <= 0 || !isFinite(body.amount)) {
        sendError(res, "INVALID_AMOUNT", "amount must be a positive number", 400);
        return;
      }

      if (!body.currency || typeof body.currency !== "string") {
        sendError(res, "INVALID_CURRENCY", "currency is required", 400);
        return;
      }

      const currency = body.currency.trim().toUpperCase();
      if (!VALID_CURRENCIES.has(currency)) {
        sendError(
          res,
          "INVALID_CURRENCY",
          `currency must be one of: ${[...VALID_CURRENCIES].join(", ")}`,
          400,
        );
        return;
      }

      // Frozen contractor check
      if (frozenContractors.has(body.contractorId)) {
        sendError(
          res,
          "CONTRACTOR_FROZEN",
          "Payout rejected: contractor account is frozen",
          422,
        );
        return;
      }

      // Idempotency check
      if (body.idempotencyKey) {
        const existingId = idempotencyKeys.get(body.idempotencyKey);
        if (existingId) {
          const existing = payouts.get(existingId);
          if (existing) {
            return res.status(200).json({ success: true, data: existing, idempotent: true });
          }
        }
        idempotencyKeys.set(body.idempotencyKey, ""); // reserve key
      }

      const id = `pay-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const payout: Payout = {
        id,
        workspaceId: body.workspaceId,
        contractorId: body.contractorId,
        destinationWallet: wallet,
        amount: body.amount,
        currency,
        status: "pending",
        idempotencyKey: body.idempotencyKey,
        createdAt: new Date().toISOString(),
      };

      payouts.set(id, payout);
      if (body.idempotencyKey) {
        idempotencyKeys.set(body.idempotencyKey, id);
      }

      return res.status(201).json({ success: true, data: payout });
    } catch (err) {
      return next(err);
    }
  },
);

export function __getPayouts(): Map<string, Payout> {
  return payouts;
}

export function __resetPayouts(): void {
  payouts.clear();
  idempotencyKeys.clear();
}

export function __freezeContractor(id: string): void {
  frozenContractors.add(id);
}

export function __unfreezeContractor(id: string): void {
  frozenContractors.delete(id);
}

export default router;
