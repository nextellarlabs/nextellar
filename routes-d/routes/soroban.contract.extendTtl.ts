import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type ExtendTtlBody = {
  contractId?: string;
  entryKey?: string;
  ledgerCount: number;
};

// Mock storage for contract TTLs
const contractTtls = new Map<string, number>();

// Configuration
const MIN_TTL = 100;
const MAX_TTL = 604800; // 1 week in ledgers
const DEFAULT_TTL = 259200; // ~7 days default

/**
 * POST /soroban/contract/extend-ttl
 * Bump the TTL of a Soroban contract or storage entry.
 * Returns an unsigned envelope for client signing.
 */
router.post(
  "/soroban/contract/extend-ttl",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as ExtendTtlBody;

      if (typeof body.ledgerCount !== "number" || body.ledgerCount < 1) {
        sendError(res, "INVALID_LEDGER_COUNT", "ledgerCount must be a positive number", 400);
        return;
      }

      if (body.ledgerCount > MAX_TTL) {
        sendError(
          res,
          "TTL_CAP_EXCEEDED",
          `ledgerCount exceeds maximum allowed value of ${MAX_TTL}`,
          400,
        );
        return;
      }

      if (!body.contractId || typeof body.contractId !== "string") {
        sendError(res, "INVALID_CONTRACT_ID", "contractId is required", 400);
        return;
      }

      const target = body.contractId;

      // Check if the contract/entry exists
      if (!contractTtls.has(target) && !body.entryKey) {
        sendError(res, "UNKNOWN_ENTRY", "Contract or storage entry not found", 404);
        return;
      }

      // Current TTL
      const currentTtl = contractTtls.get(target) || DEFAULT_TTL;
      const newTtl = currentTtl + body.ledgerCount;

      // Enforce overall cap even after extend
      if (newTtl > MAX_TTL * 2) {
        sendError(
          res,
          "TTL_CAP_EXCEEDED",
          `Resulting TTL would exceed maximum allowed value of ${MAX_TTL * 2}`,
          400,
        );
        return;
      }

      // Update TTL
      contractTtls.set(target, newTtl);

      // Build an unsigned envelope for client signing
      const envelope = {
        type: "extend_ttl_envelope",
        target,
        entryKey: body.entryKey ?? null,
        previousTtl: currentTtl,
        newTtl,
        ledgerCount: body.ledgerCount,
        networkPassphrase: "Test SDF Future Network ; February 2023",
        signatures: [],
        timestamp: new Date().toISOString(),
      };

      return res.status(200).json({
        success: true,
        data: {
          envelope,
          ttl: newTtl,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __resetContractTtls(): void {
  contractTtls.clear();
}

export function __seedContractTtl(contractId: string, ttl: number): void {
  contractTtls.set(contractId, ttl);
}

export default router;