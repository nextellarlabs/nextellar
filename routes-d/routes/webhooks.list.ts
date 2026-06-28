import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type Webhook = {
  id: string;
  url: string;
  userId: string;
  events: string[];
  sharedSecret: string;
  createdAt: string;
};

type MaskedWebhook = Omit<Webhook, "sharedSecret"> & { sharedSecret: string };

// In-memory storage for webhooks (mock database)
const webhooks = new Map<string, Webhook>();

function maskSecret(secret: string): string {
  if (secret.length <= 4) return "****";
  return secret.slice(0, 4) + "****";
}

/**
 * GET /webhooks
 * List webhook subscriptions belonging to the calling user.
 * Shared secrets are masked in the response.
 * Optionally filter by event type via ?eventType=<type>.
 */
router.get(
  "/webhooks",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.body?.userId || (req.headers["x-user-id"] as string | undefined);

      if (!userId || typeof userId !== "string") {
        sendError(res, "UNAUTHORIZED", "User authentication required", 401);
        return;
      }

      const eventType = req.query.eventType as string | undefined;

      let userWebhooks = Array.from(webhooks.values()).filter(
        (w) => w.userId === userId,
      );

      if (eventType) {
        userWebhooks = userWebhooks.filter((w) => w.events.includes(eventType));
      }

      const masked: MaskedWebhook[] = userWebhooks.map((w) => ({
        ...w,
        sharedSecret: maskSecret(w.sharedSecret),
      }));

      return res.status(200).json({
        success: true,
        data: masked,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedWebhook(webhook: Webhook): void {
  webhooks.set(webhook.id, webhook);
}

export function __resetWebhooks(): void {
  webhooks.clear();
}

export function __getWebhooks(): Map<string, Webhook> {
  return webhooks;
}

export default router;
