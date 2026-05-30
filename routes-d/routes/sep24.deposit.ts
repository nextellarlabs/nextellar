import { Router, type NextFunction, type Request, type Response } from "express";
import {
  createDepositIntent,
  transitionDepositStatus,
  type DepositStatus,
} from "../lib/sep24.js";

const router = Router();

function readString(body: Record<string, unknown> | undefined, key: string): string {
  return typeof body?.[key] === "string" ? body[key].trim() : "";
}

router.post(
  "/sep24/deposit",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const accountId = readString(req.body, "accountId");
      const assetCode = readString(req.body, "assetCode");
      const assetIssuer = readString(req.body, "assetIssuer") || undefined;
      const amount = readString(req.body, "amount") || undefined;
      const memo = readString(req.body, "memo") || undefined;
      const webhookUrl = readString(req.body, "webhookUrl") || undefined;
      const redirectUrl = readString(req.body, "redirectUrl") || undefined;
      const customerId = readString(req.body, "customerId") || undefined;

      if (!accountId || !assetCode) {
        res.status(400).json({ error: "accountId and assetCode are required" });
        return;
      }

      const intent = createDepositIntent({
        accountId,
        assetCode,
        assetIssuer,
        amount,
        memo,
        webhookUrl,
        redirectUrl,
        customerId,
      });

      await transitionDepositStatus(intent.id, "interactive");

      res.status(201).json({
        success: true,
        data: {
          depositId: intent.id,
          status: intent.status,
          interactiveUrl: intent.interactiveUrl,
          expiresAt: intent.expiresAt,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/sep24/deposit/:intentId/status",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const intentId = typeof req.params.intentId === "string" ? req.params.intentId : "";
      const nextStatus = typeof req.body?.status === "string" ? req.body.status.trim() : "";

      if (!intentId || !nextStatus) {
        res.status(400).json({ error: "intentId and status are required" });
        return;
      }

      const status = nextStatus as DepositStatus;
      const updated = await transitionDepositStatus(intentId, status);

      if (!updated) {
        res.status(404).json({ error: "deposit_intent_not_found" });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          depositId: updated.id,
          status: updated.status,
          updatedAt: updated.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
