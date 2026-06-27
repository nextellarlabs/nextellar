import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";
import crypto from "crypto";

const router = Router();

const VALID_CURRENCIES = new Set(["USD", "EUR", "GBP", "XLM", "USDC"]);

type Contract = {
  id: string;
  workspaceId: string;
  contractorId: string;
  rate: number;
  currency: string;
  term: string;
  jurisdiction: string;
  contentHash: string;
  status: "active" | "draft" | "terminated";
  createdAt: string;
};

// In-memory store
const contracts = new Map<string, Contract>();
const contentHashes = new Map<string, string>(); // contentHash -> contractId

/**
 * POST /lancepay/contracts
 * Create a work contract between a LancePay workspace and a contractor.
 */
router.post(
  "/lancepay/contracts",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        workspaceId,
        contractorId,
        rate,
        currency,
        term,
        jurisdiction,
      } = req.body;

      if (!workspaceId || typeof workspaceId !== "string") {
        sendError(res, "INVALID_WORKSPACE_ID", "workspaceId is required", 400);
        return;
      }

      if (!contractorId || typeof contractorId !== "string") {
        sendError(res, "INVALID_CONTRACTOR_ID", "contractorId is required", 400);
        return;
      }

      if (typeof rate !== "number" || rate <= 0 || !isFinite(rate)) {
        sendError(res, "INVALID_RATE", "rate must be a positive number", 400);
        return;
      }

      if (!currency || typeof currency !== "string") {
        sendError(res, "INVALID_CURRENCY", "currency is required", 400);
        return;
      }

      const cur = currency.trim().toUpperCase();
      if (!VALID_CURRENCIES.has(cur)) {
        sendError(
          res,
          "INVALID_CURRENCY",
          `currency must be one of: ${[...VALID_CURRENCIES].join(", ")}`,
          400,
        );
        return;
      }

      if (!term || typeof term !== "string") {
        sendError(res, "INVALID_TERM", "term is required", 400);
        return;
      }

      if (!jurisdiction || typeof jurisdiction !== "string") {
        sendError(res, "INVALID_JURISDICTION", "jurisdiction is required", 400);
        return;
      }

      // Generate content hash for idempotency based on the terms
      const hashInput = `${workspaceId}:${contractorId}:${rate}:${cur}:${term}:${jurisdiction}`;
      const contentHash = crypto.createHash("sha256").update(hashInput).digest("hex");

      // Idempotent against duplicate creation by content hash
      const existingId = contentHashes.get(contentHash);
      if (existingId) {
        const existing = contracts.get(existingId);
        if (existing) {
          return res.status(200).json({ success: true, data: existing, idempotent: true });
        }
      }

      const id = `contract-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const contract: Contract = {
        id,
        workspaceId,
        contractorId,
        rate,
        currency: cur,
        term,
        jurisdiction,
        contentHash,
        status: "draft",
        createdAt: new Date().toISOString(),
      };

      contracts.set(id, contract);
      contentHashes.set(contentHash, id);

      return res.status(201).json({ success: true, data: contract });
    } catch (err) {
      return next(err);
    }
  },
);

export function __getContracts(): Map<string, Contract> {
  return contracts;
}

export function __resetContracts(): void {
  contracts.clear();
  contentHashes.clear();
}

export default router;
