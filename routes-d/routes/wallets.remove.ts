import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

// Mock linked wallets storage
const linkedWallets = new Map<string, Set<string>>();
const walletToAccount = new Map<string, string>();

/**
 * DELETE /wallets/:id
 * Detach a linked wallet from the authenticated user's account.
 * Requires fresh authentication and rejects removal of the last wallet without confirmation.
 */
router.delete(
  "/wallets/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user?.sub;
      if (!userId) {
        sendError(res, "UNAUTHORIZED", "User not authenticated", 401);
        return;
      }

      const { id } = req.params;
      if (!id || typeof id !== "string") {
        sendError(res, "INVALID_WALLET_ADDRESS", "walletAddress must be a valid Stellar public key (56 chars starting with G)", 400);
        return;
      }

      if (!id.startsWith("G") || id.length !== 56) {
        sendError(
          res,
          "INVALID_WALLET_ADDRESS",
          "walletAddress must be a valid Stellar public key (56 chars starting with G)",
          400,
        );
        return;
      }

      const userWallets = linkedWallets.get(userId);
      if (!userWallets || !userWallets.has(id)) {
        sendError(
          res,
          "FORBIDDEN",
          "The specified wallet is not linked to your account",
          403,
        );
        return;
      }

      // Block removal of the last wallet unless confirmed
      if (userWallets.size === 1) {
        const confirmed = req.body.confirmed === true;
        if (!confirmed) {
          sendError(
            res,
            "LAST_WALLET_REMOVAL_BLOCKED",
            "Cannot remove the last wallet without confirmation. Send { confirmed: true } to proceed.",
            400,
          );
          return;
        }
      }

      // Remove wallet
      userWallets.delete(id);
      walletToAccount.delete(id);

      res.status(200).json({
        success: true,
        data: {
          removed: id,
          remainingWallets: Array.from(userWallets),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export function __resetWallets(): void {
  linkedWallets.clear();
  walletToAccount.clear();
}

export function __addWallet(userId: string, walletAddress: string): void {
  if (!linkedWallets.has(userId)) {
    linkedWallets.set(userId, new Set());
  }
  linkedWallets.get(userId)!.add(walletAddress);
  walletToAccount.set(walletAddress, userId);
}

export function __getUserWallets(userId: string): Set<string> | undefined {
  return linkedWallets.get(userId);
}

export default router;