import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

const usedSalts = new Set<string>();
const knownWasmHashes = new Set<string>([
  "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
]);

export function __resetDeploy(): void {
  usedSalts.clear();
  knownWasmHashes.clear();
  knownWasmHashes.add("abc123def456abc123def456abc123def456abc123def456abc123def456abc1");
}

export function __addWasmHash(hash: string): void {
  knownWasmHashes.add(hash);
}

type DeployBody = {
  wasmHash: string;
  salt: string;
};

function isValidWasmHash(hash: string): boolean {
  return typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash);
}

function isValidSalt(salt: string): boolean {
  return typeof salt === "string" && salt.trim().length > 0 && salt.length <= 64;
}

function deriveContractId(wasmHash: string, salt: string): string {
  return `contract_${wasmHash.slice(0, 8)}_${salt.slice(0, 8)}`;
}

router.post("/soroban/contract/deploy", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as DeployBody;

    if (!body.wasmHash || !body.salt) {
      sendError(res, "MISSING_FIELDS", "wasmHash and salt are required", 400);
      return;
    }

    if (!isValidWasmHash(body.wasmHash)) {
      sendError(res, "INVALID_WASM_HASH", "wasmHash must be a 64-character lowercase hex string", 400);
      return;
    }

    if (!isValidSalt(body.salt)) {
      sendError(res, "INVALID_SALT", "salt must be a non-empty string of at most 64 characters", 400);
      return;
    }

    if (!knownWasmHashes.has(body.wasmHash)) {
      sendError(res, "WASM_NOT_FOUND", "wasm hash not found in registry", 404);
      return;
    }

    const saltKey = `${body.wasmHash}:${body.salt}`;
    if (usedSalts.has(saltKey)) {
      sendError(res, "DUPLICATE_SALT", "A contract has already been deployed with this wasm hash and salt", 409);
      return;
    }

    usedSalts.add(saltKey);
    const contractId = deriveContractId(body.wasmHash, body.salt);

    return res.status(201).json({
      success: true,
      data: { contractId },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
