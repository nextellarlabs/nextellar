import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type IssueCardBody = {
  userId: string;
  fundingWalletId: string;
  currency: string;
  spendLimitAmount: string;
};

type CardRecord = {
  cardId: string;
  userId: string;
  fundingWalletId: string;
  currency: string;
  maskedNumber: string;
  expiryMonth: string;
  expiryYear: string;
  spendLimitAmount: string;
  issuedAt: string;
};

type ComplianceRecord = {
  kycPassed: boolean;
  eligible: boolean;
};

const SUPPORTED_CURRENCIES = new Set(["USDC", "USDT", "XLM"]);

const cardStore = new Map<string, CardRecord>();
const complianceStore = new Map<string, ComplianceRecord>();

let cardCounter = 1;

export function __resetCardStore(): void {
  cardStore.clear();
  complianceStore.clear();
  cardCounter = 1;
}

export function __setCompliance(userId: string, record: ComplianceRecord): void {
  complianceStore.set(userId, record);
}

export function __getCard(cardId: string): CardRecord | undefined {
  return cardStore.get(cardId);
}

function generateCardId(): string {
  return `card-${String(cardCounter++).padStart(6, "0")}`;
}

function maskCardNumber(): string {
  const last4 = String(Math.floor(1000 + Math.random() * 9000));
  return `****-****-****-${last4}`;
}

function getComplianceStatus(userId: string): ComplianceRecord {
  return complianceStore.get(userId) ?? { kycPassed: true, eligible: true };
}

router.post("/cards", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.headers["x-user-id"] as string | undefined;

    if (!userId) {
      sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
      return;
    }

    const body = req.body as IssueCardBody;

    if (!body.fundingWalletId || typeof body.fundingWalletId !== "string") {
      sendError(res, "INVALID_WALLET_ID", "fundingWalletId is required", 400);
      return;
    }

    if (!body.currency || typeof body.currency !== "string") {
      sendError(res, "INVALID_CURRENCY", "currency is required", 400);
      return;
    }

    const currency = body.currency.toUpperCase();
    if (!SUPPORTED_CURRENCIES.has(currency)) {
      sendError(
        res,
        "UNSUPPORTED_CURRENCY",
        `currency must be one of: ${[...SUPPORTED_CURRENCIES].join(", ")}`,
        400,
      );
      return;
    }

    if (!body.spendLimitAmount || typeof body.spendLimitAmount !== "string") {
      sendError(res, "INVALID_SPEND_LIMIT", "spendLimitAmount is required", 400);
      return;
    }

    const spendLimit = parseFloat(body.spendLimitAmount);
    if (isNaN(spendLimit) || spendLimit <= 0) {
      sendError(res, "INVALID_SPEND_LIMIT", "spendLimitAmount must be a positive number", 400);
      return;
    }

    const compliance = getComplianceStatus(userId);

    if (!compliance.kycPassed) {
      sendError(res, "KYC_REQUIRED", "KYC verification is required before issuing a card", 403);
      return;
    }

    if (!compliance.eligible) {
      sendError(res, "INELIGIBLE", "Account is not eligible for virtual card issuance", 403);
      return;
    }

    const now = new Date();
    const expiryYear = String(now.getFullYear() + 3);
    const expiryMonth = String(now.getMonth() + 1).padStart(2, "0");

    const cardId = generateCardId();
    const maskedNumber = maskCardNumber();
    const issuedAt = now.toISOString();

    const record: CardRecord = {
      cardId,
      userId,
      fundingWalletId: body.fundingWalletId,
      currency,
      maskedNumber,
      expiryMonth,
      expiryYear,
      spendLimitAmount: body.spendLimitAmount,
      issuedAt,
    };

    cardStore.set(cardId, record);

    return res.status(201).json({
      success: true,
      data: {
        cardId,
        maskedNumber,
        expiryMonth,
        expiryYear,
        currency,
        spendLimitAmount: body.spendLimitAmount,
        issuedAt,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
