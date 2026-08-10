import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type SetDefaultWalletBody = {
  walletAddress: string;
};

// Mock storage for user default wallets and linked wallets
const userDefaultWallets = new Map<string, string>();
const linkedWallets = new Map<string, Set<string>>();

/**
 * POST /wallets/default
 * Set the default Stellar wallet for the authenticated user.
 * Validates that the target wallet belongs to the caller.
 */
router.post(
  "/wallets/default",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user?.sub;
      if (!userId) {
        sendError(res, "UNAUTHORIZED", "User not authenticated", 401);
        return;
      }

      const body = req.body as SetDefaultWalletBody;

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

      const userWallets = linkedWallets.get(userId);
      if (!userWallets || !userWallets.has(body.walletAddress)) {
        sendError(
          res,
          "FORBIDDEN",
          "The specified wallet is not linked to your account",
          403,
        );
        return;
      }

      const previousDefault = userDefaultWallets.get(userId);
      const isUnchanged = previousDefault === body.walletAddress;

      // Atomic update
      userDefaultWallets.set(userId, body.walletAddress);

      // Emit audit event (mock)
      console.log(
        JSON.stringify({
          audit: true,
          event: "WALLET_DEFAULT_SET",
          userId,
          walletAddress: body.walletAddress,
          previousDefault,
          unchanged: isUnchanged,
          timestamp: new Date().toISOString(),
        }),
      );

      return res.status(200).json({
        success: true,
        data: {
          defaultWallet: body.walletAddress,
          unchanged: isUnchanged,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __resetDefaultWallets(): void {
  userDefaultWallets.clear();
}

export function __seedLinkedWallet(userId: string, walletAddress: string): void {
  if (!linkedWallets.has(userId)) {
    linkedWallets.set(userId, new Set());
  }
  linkedWallets.get(userId)!.add(walletAddress);
}

export function __getDefaultWallet(userId: string): string | undefined {
  return userDefaultWallets.get(userId);
}

export default router;