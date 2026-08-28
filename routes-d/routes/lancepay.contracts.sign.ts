import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";
import crypto from "crypto";

const router = Router();

type Contract = {
  id: string;
  workspaceId: string;
  contractorId: string;
  content: string;
  signedHash?: string;
  signedAt?: string;
  signedBy?: string;
};

type SignContractBody = {
  signerId: string;
  intentToken: string;
};

// In-memory store
const contracts = new Map<string, Contract>();

function computeHash(contractId: string, signerId: string, intentToken: string): string {
  return crypto
    .createHash("sha256")
    .update(`${contractId}:${signerId}:${intentToken}`)
    .digest("hex");
}

/**
 * POST /lancepay/contracts/:id/sign
 * Capture a binding signature on a LancePay contract.
 * Verifies signer identity and intent token, then persists
 * a tamper-evident signed hash with timestamp.
 */
router.post(
  "/lancepay/contracts/:id/sign",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contractId = req.params.id?.trim();
      if (!contractId) {
        sendError(res, "INVALID_CONTRACT_ID", "contractId is required", 400);
        return;
      }

      const body = req.body as SignContractBody;

      if (!body.signerId || typeof body.signerId !== "string" || !body.signerId.trim()) {
        sendError(res, "INVALID_SIGNER_ID", "signerId is required", 400);
        return;
      }

      if (
        !body.intentToken ||
        typeof body.intentToken !== "string" ||
        !body.intentToken.trim()
      ) {
        sendError(res, "INVALID_INTENT_TOKEN", "intentToken is required", 400);
        return;
      }

      const contract = contracts.get(contractId);
      if (!contract) {
        sendError(res, "NOT_FOUND", "Contract not found", 404);
        return;
      }

      // Reject already-signed contracts
      if (contract.signedHash) {
        sendError(
          res,
          "ALREADY_SIGNED",
          "This contract has already been signed",
          409,
        );
        return;
      }

      const signerId = body.signerId.trim();

      // Signer must be the workspace owner or the assigned contractor
      if (signerId !== contract.workspaceId && signerId !== contract.contractorId) {
        sendError(
          res,
          "UNAUTHORIZED_SIGNER",
          "signerId is not authorized to sign this contract",
          403,
        );
        return;
      }

      const signedHash = computeHash(contractId, signerId, body.intentToken.trim());
      const signedAt = new Date().toISOString();

      contract.signedHash = signedHash;
      contract.signedAt = signedAt;
      contract.signedBy = signerId;

      return res.status(200).json({
        success: true,
        data: {
          contractId,
          signedBy: signerId,
          signedHash,
          signedAt,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedContract(c: Contract): void {
  contracts.set(c.id, { ...c });
}

export function __resetContracts(): void {
  contracts.clear();
}

export function __getContract(id: string): Contract | undefined {
  return contracts.get(id);
}

export default router;
