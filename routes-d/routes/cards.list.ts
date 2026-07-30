import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type CardStatus = "active" | "closed" | "suspended";

interface Card {
  id: string;
  userId: string;
  maskedNumber: string;
  status: CardStatus;
  label?: string;
  createdAt: string;
}

const cardStore = new Map<string, Card[]>();

export function __seedCards(userId: string, cards: Card[]): void {
  cardStore.set(userId, cards);
}

export function __resetCardStore(): void {
  cardStore.clear();
}

router.get(
  "/cards",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers["x-user-id"] as string | undefined;
      if (!userId) {
        sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
        return;
      }

      const userCards = cardStore.get(userId) ?? [];

      // Active cards first, then closed/suspended
      const sorted = [...userCards].sort((a, b) => {
        const aActive = a.status === "active" ? 0 : 1;
        const bActive = b.status === "active" ? 0 : 1;
        return aActive - bActive;
      });

      res.status(200).json({
        success: true,
        data: sorted.map((card) => ({
          id: card.id,
          maskedNumber: card.maskedNumber,
          status: card.status,
          label: card.label ?? null,
          createdAt: card.createdAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
