import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type AuthEntry = {
  contractId: string;
  method: string;
  args?: unknown[];
  nonce?: string;
};

type SignedAuthEntry = {
  contractId: string;
  method: string;
  signature: string;
  signedAt: string;
};

// Allowlist of contracts and their permitted methods
const ALLOWLIST: Record<string, string[]> = {
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM": ["transfer", "approve", "balance"],
  "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB": ["swap", "add_liquidity", "remove_liquidity"],
  "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC": ["mint", "burn"],
};

// Mock server key (in production, this would be securely stored)
const SERVER_KEY = "GDSAMPLESERVERKEY123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * POST /soroban/auth/sign
 * Signs a Soroban authorization entry with the server key.
 * Validates against an allowlist of contracts and methods.
 */
router.post(
  "/soroban/auth/sign",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = req.body as Partial<AuthEntry>;

      // Validate required fields
      if (!entry.contractId || typeof entry.contractId !== "string" || entry.contractId.trim() === "") {
        sendError(res, "MISSING_CONTRACT_ID", "contractId is required and must be a non-empty string", 400);
        return;
      }

      if (!entry.method || typeof entry.method !== "string" || entry.method.trim() === "") {
        sendError(res, "MISSING_METHOD", "method is required and must be a non-empty string", 400);
        return;
      }

      // Validate contract is in allowlist
      const allowedMethods = ALLOWLIST[entry.contractId];
      if (!allowedMethods) {
        sendError(
          res,
          "UNAUTHORIZED_CONTRACT",
          `Contract ${entry.contractId} is not authorized for signing`,
          403
        );
        return;
      }

      // Validate method is allowed for this contract
      if (!allowedMethods.includes(entry.method)) {
        sendError(
          res,
          "UNAUTHORIZED_METHOD",
          `Method ${entry.method} is not authorized for contract ${entry.contractId}`,
          403
        );
        return;
      }

      // Generate signature (mock implementation - in production would use real crypto)
      const payload = JSON.stringify({
        contractId: entry.contractId,
        method: entry.method,
        args: entry.args || [],
        nonce: entry.nonce || "",
        serverKey: SERVER_KEY,
      });

      const signature = Buffer.from(payload).toString("base64");

      const signedEntry: SignedAuthEntry = {
        contractId: entry.contractId,
        method: entry.method,
        signature,
        signedAt: new Date().toISOString(),
      };

      return res.status(200).json({
        success: true,
        data: signedEntry,
      });
    } catch (err) {
      return next(err);
    }
  }
);

export function __getAllowlist(): Record<string, string[]> {
  return ALLOWLIST;
}

export function __getServerKey(): string {
  return SERVER_KEY;
}

export default router;
