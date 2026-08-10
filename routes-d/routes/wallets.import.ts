import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type ImportWalletBody = {
  publicKey: string;
  challenge: string;
  signature: string;
};

type ImportedWallet = {
  publicKey: string;
  importedAt: string;
};

// Mock database of imported wallets
const importedWallets = new Map<string, ImportedWallet>();
const revokedKeys = new Set<string>();

/**
 * POST /wallets/import
 * Import an existing Stellar wallet by public key after challenge-based verification.
 */
router.post(
  "/wallets/import",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as ImportWalletBody;

      // Validate publicKey
      if (!body.publicKey || typeof body.publicKey !== "string") {
        sendError(res, "INVALID_PUBLIC_KEY", "publicKey is required and must be a string", 400);
        return;
      }

      if (!body.publicKey.startsWith("G") || body.publicKey.length !== 56) {
        sendError(
          res,
          "INVALID_PUBLIC_KEY",
          "publicKey must be a valid Stellar public key (56 chars starting with G)",
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

      // Check if key is revoked
      if (revokedKeys.has(body.publicKey)) {
        sendError(res, "KEY_REVOKED", "This public key has been revoked and cannot be imported", 403);
        return;
      }

      // Check for duplicate
      if (importedWallets.has(body.publicKey)) {
        sendError(res, "WALLET_ALREADY_IMPORTED", "This wallet has already been imported", 409);
        return;
      }

      // Verify challenge signature
      // In a real implementation, this would use Stellar SDK to verify the signature
      // For now, we do a simple validation
      if (body.signature.length < 10) {
        sendError(res, "CHALLENGE_VERIFICATION_FAILED", "Challenge signature verification failed", 400);
        return;
      }

      // Import the wallet
      const wallet: ImportedWallet = {
        publicKey: body.publicKey,
        importedAt: new Date().toISOString(),
      };
      importedWallets.set(body.publicKey, wallet);

      return res.status(201).json({
        success: true,
        data: wallet,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __getImportedWallets(): Map<string, ImportedWallet> {
  return importedWallets;
}

export function __getRevokedKeys(): Set<string> {
  return revokedKeys;
}

export function __addRevokedKey(publicKey: string): void {
  revokedKeys.add(publicKey);
}

export function __resetImportedWallets(): void {
  importedWallets.clear();
  revokedKeys.clear();
}

export default router;
