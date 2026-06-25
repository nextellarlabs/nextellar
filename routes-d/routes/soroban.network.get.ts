import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

let rpcAvailable = true;
let networkPassphrase = "Test SDF Network ; September 2015";
let rpcUrl = "https://soroban-testnet.stellar.org";
let latestLedger = 12345678;

export function __resetNetwork(): void {
  rpcAvailable = true;
  networkPassphrase = "Test SDF Network ; September 2015";
  rpcUrl = "https://soroban-testnet.stellar.org";
  latestLedger = 12345678;
}

export function __setRpcAvailable(available: boolean): void {
  rpcAvailable = available;
}

export function __setNetworkConfig(passphrase: string, url: string, ledger: number): void {
  networkPassphrase = passphrase;
  rpcUrl = url;
  latestLedger = ledger;
}

router.get("/soroban/network", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!rpcAvailable) {
      sendError(res, "RPC_UNAVAILABLE", "Soroban RPC is currently unavailable", 503);
      return;
    }

    const rpcHost = new URL(rpcUrl).host;

    return res.status(200).json({
      success: true,
      data: {
        networkPassphrase,
        rpcHost,
        latestLedger,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
