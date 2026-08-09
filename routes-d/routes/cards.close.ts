import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  frozenAt?: string;
  closedAt?: string;
};

type PendingTransaction = {
  txId: string;
  cardId: string;
  /** Amount as a decimal string, e.g. "12.50" */
  amount: string;
  settledAt?: string;
};

type AuditEvent = {
  cardId: string;
  action: "close";
  performedBy: string;
  timestamp: string;
};

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

const cardStore = new Map<string, CardRecord>();
/** Pending (unsettled) transactions keyed by txId. */
const pendingTxStore = new Map<string, PendingTransaction>();
const auditEvents: AuditEvent[] = [];

// ---------------------------------------------------------------------------
// Test-only helpers (prefixed with __ to signal internal use)
// ---------------------------------------------------------------------------

export function __resetCardStore(): void {
  cardStore.clear();
  pendingTxStore.clear();
  auditEvents.length = 0;
}

export function __seedCard(card: CardRecord): void {
  cardStore.set(card.cardId, card);
}

export function __getCard(cardId: string): CardRecord | undefined {
  return cardStore.get(cardId);
}

export function __seedPendingTx(tx: PendingTransaction): void {
  pendingTxStore.set(tx.txId, tx);
}

export function __getAuditEvents(): AuditEvent[] {
  return auditEvents;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FRESH_AUTH_SECONDS = 300; // 5 minutes

// ---------------------------------------------------------------------------
// Route: DELETE /cards/:id
// ---------------------------------------------------------------------------

/**
 * Close a virtual card.
 *
 * Required headers:
 *   x-user-id          – authenticated user id
 *   x-auth-timestamp   – unix epoch in ms; must be within FRESH_AUTH_SECONDS
 *
 * Business rules:
 *   1. Card must exist and belong to the requesting user.
 *   2. Fresh authentication is required.
 *   3. A card that is already closed cannot be closed again (409).
 *   4. A card with unsettled (pending) transactions cannot be closed (409).
 *   5. On success the card status is set to "closed" and an audit event is emitted.
 */
router.delete(
  "/cards/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.headers["x-user-id"] as string | undefined;
      const authTimestamp = req.headers["x-auth-timestamp"] as string | undefined;

      // --- Validate card id ---
      const cardId = id?.trim();
      if (!cardId) {
        sendError(res, "INVALID_CARD_ID", "cardId is required", 400);
        return;
      }

      // --- Validate user identity ---
      if (!userId) {
        sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
        return;
      }

      // --- Lookup card ---
      const card = cardStore.get(cardId);
      if (!card) {
        sendError(res, "CARD_NOT_FOUND", "Card not found", 404);
        return;
      }

      // --- Ownership check ---
      if (card.userId !== userId) {
        sendError(res, "FORBIDDEN", "You do not have permission to close this card", 403);
        return;
      }

      // --- Fresh authentication check ---
      if (!authTimestamp) {
        sendError(res, "REAUTH_REQUIRED", "Fresh authentication required", 403);
        return;
      }

      const authTime = parseInt(authTimestamp, 10);
      if (isNaN(authTime) || Date.now() - authTime > FRESH_AUTH_SECONDS * 1000) {
        sendError(res, "REAUTH_REQUIRED", "Fresh authentication required", 403);
        return;
      }

      // --- Already closed ---
      if (card.status === "closed") {
        sendError(res, "CARD_ALREADY_CLOSED", "Card is already closed", 409);
        return;
      }

      // --- Pending transaction check ---
      const pendingForCard = [...pendingTxStore.values()].filter(
        (tx) => tx.cardId === cardId && !tx.settledAt,
      );
      if (pendingForCard.length > 0) {
        sendError(
          res,
          "PENDING_TRANSACTIONS",
          "Card has pending transactions that must settle before it can be closed",
          409,
        );
        return;
      }

      // --- Close the card ---
      const now = new Date().toISOString();
      card.status = "closed";
      card.closedAt = now;

      const auditEvent: AuditEvent = {
        cardId,
        action: "close",
        performedBy: userId,
        timestamp: now,
      };
      auditEvents.push(auditEvent);

      return res.status(200).json({
        success: true,
        data: {
          cardId,
          status: "closed",
          closedAt: now,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
