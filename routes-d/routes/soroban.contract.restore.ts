import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type ContractState = "active" | "archived" | "unknown";

const contracts = new Map<string, ContractState>();

function getContractState(contractId: string): ContractState {
  if (contracts.has(contractId)) {
    return contracts.get(contractId)!;
  }
  if (contractId.startsWith("active-")) return "active";
  if (contractId.startsWith("archived-")) return "archived";
  return "unknown";
}

type RestoreBody = {
  contractId: string;
  sourceAccount: string;
};

router.post("/soroban/contract/restore", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as RestoreBody;

    if (!body.contractId || typeof body.contractId !== "string" ||
        !body.sourceAccount || typeof body.sourceAccount !== "string") {
      sendError(res, "MISSING_FIELDS", "contractId and sourceAccount are required", 400);
      return;
    }

    const state = getContractState(body.contractId);

    if (state === "active") {
      sendError(res, "CONTRACT_ALREADY_ACTIVE", "Contract is already active and does not need restoration", 409);
      return;
    }

    if (state === "archived") {
      const unsignedEnvelope = `unsigned_restore_envelope_${body.contractId}_${body.sourceAccount}`;
      return res.status(200).json({
        success: true,
        data: {
          contractId: body.contractId,
          state: "archived",
          feeEstimate: { stroops: 500, xlm: "0.0000050" },
          unsignedEnvelope,
        },
      });
    }

    sendError(res, "CONTRACT_NOT_FOUND", "Contract not found or state cannot be determined", 404);
    return;
  } catch (err) {
    return next(err);
  }
});

export function __resetContracts(): void {
  contracts.clear();
}

export default router;
