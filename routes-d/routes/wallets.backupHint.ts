import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

export const MAX_BLOB_BYTES = 4096;

type BackupHintBody = {
  walletId: string;
  ciphertext: string;
};

type HintRecord = {
  walletId: string;
  ownerUserId: string;
  ciphertext: string;
  storedAt: string;
};

const hintStore = new Map<string, HintRecord>();

export function __resetHintStore(): void {
  hintStore.clear();
}

export function __getHint(walletId: string): HintRecord | undefined {
  return hintStore.get(walletId);
}

router.post("/wallets/backup-hint", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.headers["x-user-id"] as string | undefined;

    if (!userId) {
      sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
      return;
    }

    const body = req.body as BackupHintBody;

    if (!body.walletId || typeof body.walletId !== "string") {
      sendError(res, "INVALID_WALLET_ID", "walletId is required", 400);
      return;
    }

    if (!body.ciphertext || typeof body.ciphertext !== "string") {
      sendError(res, "INVALID_CIPHERTEXT", "ciphertext is required", 400);
      return;
    }

    if (body.ciphertext.length > MAX_BLOB_BYTES) {
      sendError(res, "BLOB_TOO_LARGE", `ciphertext must not exceed ${MAX_BLOB_BYTES} bytes`, 400);
      return;
    }

    const existing = hintStore.get(body.walletId);
    if (existing && existing.ownerUserId !== userId) {
      sendError(res, "FORBIDDEN", "wallet does not belong to this user", 403);
      return;
    }

    const storedAt = new Date().toISOString();
    hintStore.set(body.walletId, { walletId: body.walletId, ownerUserId: userId, ciphertext: body.ciphertext, storedAt });

    return res.status(201).json({
      success: true,
      data: { walletId: body.walletId, storedAt },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
