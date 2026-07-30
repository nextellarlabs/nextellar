import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type CardStatus = "active" | "frozen" | "closed";

type CardRecord = {
  cardId: string;
  userId: string;
  status: CardStatus;
  maskedNumber: string;
  expiryMonth: string;
  expiryYear: string;
  currency: string;
  spendLimitAmount: string;
  issuedAt: string;
};

type ComplianceRecord = {
  kycPassed: boolean;
  eligible: boolean;
  maxSpendLimit?: string;
};

type AuditEvent = {
  cardId: string;
  action: "limit_set";
  performedBy: string;
  limit: string;
  timestamp: string;
};

type TierLimits = {
  bronze: number;
  silver: number;
  gold: number;
};

const TIER_LIMITS: TierLimits = {
  bronze: 1000,
  silver: 5000,
  gold: 10000,
};

const cardStore = new Map<string, CardRecord>();
const complianceStore = new Map<string, ComplianceRecord>();
const auditEvents: AuditEvent[] = [];
const tierStore = new Map<string, keyof TierLimits>();

export function __resetCardStore(): void {
  cardStore.clear();
  complianceStore.clear();
  auditEvents.length = 0;
  tierStore.clear();
}

export function __seedCard(card: CardRecord): void {
  cardStore.set(card.cardId, card);
}

export function __getCard(cardId: string): CardRecord | undefined {
  return cardStore.get(cardId);
}

export function __setCompliance(userId: string, record: ComplianceRecord): void {
  complianceStore.set(userId, record);
}

export function __setUserTier(userId: string, tier: keyof TierLimits): void {
  tierStore.set(userId, tier);
}

export function __getAuditEvents(): AuditEvent[] {
  return auditEvents;
}

function getTierLimit(userId: string): number {
  const tier = tierStore.get(userId) ?? "bronze";
  return TIER_LIMITS[tier];
}

router.post(
  "/cards/:id/limit",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.headers["x-user-id"] as string | undefined;

      const cardId = id?.trim();
      if (!cardId) {
        sendError(res, "INVALID_CARD_ID", "cardId is required", 400);
        return;
      }

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
        return;
      }

      const card = cardStore.get(cardId);

      if (!card) {
        sendError(res, "CARD_NOT_FOUND", "Card not found", 404);
        return;
      }

      if (card.userId !== userId) {
        sendError(res, "FORBIDDEN", "You do not have permission to modify this card", 403);
        return;
      }

      const body = req.body as { spendLimitAmount?: unknown };

      if (body.spendLimitAmount === undefined || typeof body.spendLimitAmount !== "string") {
        sendError(res, "INVALID_SPEND_LIMIT", "spendLimitAmount is required and must be a string", 400);
        return;
      }

      const spendLimit = parseFloat(body.spendLimitAmount);
      if (isNaN(spendLimit) || spendLimit <= 0) {
        sendError(res, "INVALID_SPEND_LIMIT", "spendLimitAmount must be a positive number", 400);
        return;
      }

      const compliance = complianceStore.get(userId);
      if (compliance && compliance.maxSpendLimit) {
        const maxLimit = parseFloat(compliance.maxSpendLimit);
        if (!isNaN(maxLimit) && spendLimit > maxLimit) {
          sendError(
            res,
            "LIMIT_EXCEEDED",
            `Spend limit cannot exceed ${compliance.maxSpendLimit}`,
            403,
          );
          return;
        }
      }

      const tierLimit = getTierLimit(userId);
      if (spendLimit > tierLimit) {
        sendError(
          res,
          "TIER_LIMIT_EXCEEDED",
          `Spend limit cannot exceed tier limit of ${tierLimit}`,
          403,
        );
        return;
      }

      const now = new Date().toISOString();
      card.spendLimitAmount = body.spendLimitAmount;

      const auditEvent: AuditEvent = {
        cardId,
        action: "limit_set",
        performedBy: userId,
        limit: body.spendLimitAmount,
        timestamp: now,
      };
      auditEvents.push(auditEvent);

      return res.status(200).json({
        success: true,
        data: {
          cardId,
          spendLimitAmount: body.spendLimitAmount,
          updatedAt: now,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;