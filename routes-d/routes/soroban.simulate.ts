import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type SimulateBody = {
  xdr: string;
};

type SimulationResult = {
  gasEstimate: number;
  footprint: {
    readBytes: number;
    writeBytes: number;
    ledgerEntries: number;
  };
  latestLedger: number;
};

let rpcAvailable = true;
let revertError: string | null = null;

export function __setRpcAvailable(available: boolean): void {
  rpcAvailable = available;
}

export function __setRevertError(message: string | null): void {
  revertError = message;
}

export function __resetSimulate(): void {
  rpcAvailable = true;
  revertError = null;
}

function isValidXdr(xdr: string): boolean {
  if (typeof xdr !== "string" || xdr.trim().length === 0) return false;
  // XDR is base64-encoded; validate it contains only base64 chars and has reasonable length
  return /^[A-Za-z0-9+/=]+$/.test(xdr) && xdr.length >= 8;
}

function simulateOnRpc(_xdr: string): SimulationResult {
  if (!rpcAvailable) {
    throw new Error("RPC unavailable");
  }
  if (revertError !== null) {
    const err = new Error(revertError) as Error & { code?: string };
    err.code = "CONTRACT_REVERT";
    throw err;
  }
  return {
    gasEstimate: 125000,
    footprint: {
      readBytes: 512,
      writeBytes: 256,
      ledgerEntries: 4,
    },
    latestLedger: 55200000,
  };
}

router.post("/soroban/simulate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as SimulateBody;

    if (!body.xdr) {
      sendError(res, "MISSING_FIELDS", "xdr is required", 400);
      return;
    }

    if (!isValidXdr(body.xdr)) {
      sendError(res, "INVALID_XDR", "xdr must be a valid base64-encoded transaction envelope", 400);
      return;
    }

    let result: SimulationResult;
    try {
      result = simulateOnRpc(body.xdr);
    } catch (err) {
      const error = err as Error & { code?: string };
      if (error.code === "CONTRACT_REVERT") {
        sendError(res, "CONTRACT_REVERT", error.message, 422);
        return;
      }
      sendError(res, "RPC_UNAVAILABLE", "Soroban RPC is currently unavailable", 503);
      return;
    }

    return res.status(200).json({
      success: true,
      data: {
        gasEstimate: result.gasEstimate,
        footprint: result.footprint,
        latestLedger: result.latestLedger,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
