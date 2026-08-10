import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type ContractVersion = {
  version: number;
  rate?: number;
  scope?: string;
  term?: string;
  amendedBy: string;
  coSignedBy?: string;
  amendedAt: string;
};

type Contract = {
  id: string;
  workspaceId: string;
  contractorId: string;
  currentVersion: number;
  rate: number;
  scope: string;
  term: string;
  history: ContractVersion[];
  createdAt: string;
  updatedAt: string;
};

type AmendContractBody = {
  amendedBy: string;
  rate?: number;
  scope?: string;
  term?: string;
  coSignedBy?: string;
};

// In-memory store (seed contracts via __seedContract for tests)
const contracts = new Map<string, Contract>();

/**
 * POST /lancepay/contracts/:id/amend
 * Amend a LancePay contract rate, scope, or term.
 * A co-signature is required when the rate changes.
 * Persists a new version row instead of overwriting.
 */
router.post(
  "/lancepay/contracts/:id/amend",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as AmendContractBody;

      if (!body.amendedBy || typeof body.amendedBy !== "string") {
        sendError(res, "INVALID_AMENDED_BY", "amendedBy is required", 400);
        return;
      }

      const contract = contracts.get(req.params.id);

      if (!contract) {
        sendError(res, "NOT_FOUND", "Contract not found", 404);
        return;
      }

      const hasRate = body.rate !== undefined;
      const hasScope = body.scope !== undefined;
      const hasTerm = body.term !== undefined;

      if (!hasRate && !hasScope && !hasTerm) {
        sendError(
          res,
          "NO_CHANGES",
          "At least one of rate, scope, or term must be provided",
          400,
        );
        return;
      }

      if (hasRate) {
        if (typeof body.rate !== "number" || body.rate <= 0 || !isFinite(body.rate)) {
          sendError(res, "INVALID_RATE", "rate must be a positive number", 400);
          return;
        }

        // Co-signature required for rate changes
        if (!body.coSignedBy || typeof body.coSignedBy !== "string") {
          sendError(
            res,
            "CO_SIGNATURE_REQUIRED",
            "A co-signature (coSignedBy) is required when amending the rate",
            422,
          );
          return;
        }
      }

      if (hasScope && (typeof body.scope !== "string" || !body.scope.trim())) {
        sendError(res, "INVALID_SCOPE", "scope must be a non-empty string", 400);
        return;
      }

      if (hasTerm && (typeof body.term !== "string" || !body.term.trim())) {
        sendError(res, "INVALID_TERM", "term must be a non-empty string", 400);
        return;
      }

      const newVersion: ContractVersion = {
        version: contract.currentVersion + 1,
        ...(hasRate && { rate: body.rate }),
        ...(hasScope && { scope: body.scope!.trim() }),
        ...(hasTerm && { term: body.term!.trim() }),
        amendedBy: body.amendedBy,
        ...(body.coSignedBy && { coSignedBy: body.coSignedBy }),
        amendedAt: new Date().toISOString(),
      };

      // Persist new version without overwriting previous rows
      contract.history.push(newVersion);
      contract.currentVersion = newVersion.version;
      if (hasRate) contract.rate = body.rate!;
      if (hasScope) contract.scope = body.scope!.trim();
      if (hasTerm) contract.term = body.term!.trim();
      contract.updatedAt = newVersion.amendedAt;

      return res.status(200).json({
        success: true,
        data: {
          contract: {
            id: contract.id,
            currentVersion: contract.currentVersion,
            rate: contract.rate,
            scope: contract.scope,
            term: contract.term,
            updatedAt: contract.updatedAt,
          },
          amendment: newVersion,
          historyCount: contract.history.length,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedContract(contract: Contract): void {
  contracts.set(contract.id, { ...contract, history: [...contract.history] });
}

export function __getContract(id: string): Contract | undefined {
  return contracts.get(id);
}

export function __resetContracts(): void {
  contracts.clear();
}

export default router;
