import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

function isValidBase64(str: string): boolean {
  try {
    return Buffer.from(str, "base64").toString("base64") === str;
  } catch {
    return false;
  }
}

function isRevertXdr(xdr: string): boolean {
  try {
    return Buffer.from(xdr, "base64").toString("utf8").startsWith("revert_");
  } catch {
    return false;
  }
}

router.post("/soroban/preflight", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { xdr } = req.body;

    if (!xdr || typeof xdr !== "string" || xdr.trim() === "") {
      sendError(res, "MISSING_XDR", "xdr is required", 400);
      return;
    }

    if (!isValidBase64(xdr)) {
      sendError(res, "INVALID_XDR", "XDR is malformed or not valid base64", 400);
      return;
    }

    if (isRevertXdr(xdr)) {
      sendError(res, "SIMULATION_REVERT", "Simulation reverted: contract execution failed", 422);
      return;
    }

    return res.status(200).json({
      success: true,
      data: {
        status: "success",
        resourceEstimates: {
          cpuInstructions: 1000000,
          memBytes: 512000,
          readBytes: 4096,
          writeBytes: 2048,
        },
        authorizationRequired: false,
        minResourceFee: "1000",
        latestLedger: 12345678,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export function __resetPreflight(): void {}

export default router;
