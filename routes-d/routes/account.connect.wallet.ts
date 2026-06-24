import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type ConnectWalletBody = {
  accountId: string;
  walletAddress: string;
  challenge: string;
  signature: string;
};

// Mock database of linked wallets
const linkedWallets = new Map<string, Set<string>>();
const walletToAccount = new Map<string, string>();

/**
 * POST /account/connect-wallet
 * Link an additional Stellar wallet to the current Nextellar account.
 */
router.post(
  "/account/connect-wallet",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as ConnectWalletBody;

      // Validate accountId
      if (!body.accountId || typeof body.accountId !== "string") {
        sendError(res, "INVALID_ACCOUNT_ID", "accountId is required and must be a string", 400);
        return;
      }

      if (!body.accountId.startsWith("G") || body.accountId.length !== 56) {
        sendError(
          res,
          "INVALID_ACCOUNT_ID",
          "accountId must be a valid Stellar public key (56 chars starting with G)",
          400,
        );
        return;
      }

      // Validate walletAddress
      if (!body.walletAddress || typeof body.walletAddress !== "string") {
        sendError(res, "INVALID_WALLET_ADDRESS", "walletAddress is required and must be a string", 400);
        return;
      }

      if (!body.walletAddress.startsWith("G") || body.walletAddress.length !== 56) {
        sendError(
          res,
          "INVALID_WALLET_ADDRESS",
          "walletAddress must be a valid Stellar public key (56 chars starting with G)",
          400,
        );
        return;
      }

      // Validate challenge
      if (!body.challenge || typeof body.challenge !== "string") {
        sendError(res, "INVALID_CHALLENGE", "challenge is required and must be a string", 400);
        return;
      }

      // Validate signature
      if (!body.signature || typeof body.signature !== "string") {
        sendError(res, "INVALID_SIGNATURE", "signature is required and must be a string", 400);
        return;
      }

      // Check if wallet is already linked to another account
      if (walletToAccount.has(body.walletAddress)) {
        const existingAccount = walletToAccount.get(body.walletAddress);
        if (existingAccount !== body.accountId) {
          sendError(
            res,
            "WALLET_ALREADY_LINKED",
            "This wallet is already linked to another account",
            409,
          );
          return;
        }
        // Wallet is already linked to the same account
        return res.status(200).json({
          success: true,
          data: {
            accountId: body.accountId,
            walletAddress: body.walletAddress,
            linked: true,
            message: "Wallet was already linked to this account",
          },
        });
      }

      // Verify challenge signature
      // In a real implementation, this would use Stellar SDK to verify the signature
      // For now, we do a simple validation
      if (body.signature.length < 10) {
        sendError(res, "INVALID_SIGNATURE", "Challenge verification failed", 400);
        return;
      }

      // Link the wallet
      if (!linkedWallets.has(body.accountId)) {
        linkedWallets.set(body.accountId, new Set());
      }
      linkedWallets.get(body.accountId)!.add(body.walletAddress);
      walletToAccount.set(body.walletAddress, body.accountId);

      return res.status(201).json({
        success: true,
        data: {
          accountId: body.accountId,
          walletAddress: body.walletAddress,
          linked: true,
          linkedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __getLinkedWallets(): Map<string, Set<string>> {
  return linkedWallets;
}

export function __getWalletToAccount(): Map<string, string> {
  return walletToAccount;
}

export function __resetWallets(): void {
  linkedWallets.clear();
  walletToAccount.clear();
}

export default router;
