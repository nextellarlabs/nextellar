import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

// In-memory storage for subscriptions (mock database)
const subscriptions = new Map<string, Subscription>();
const emittedWebhooks: Array<{ event: string; subscriptionId: string; timestamp: string }> = [];

type Subscription = {
  id: string;
  planId: string;
  billingInterval: "monthly" | "yearly";
  startDate: string;
  userId: string;
  status: "active" | "paused" | "cancelled";
  pausedAt?: string;
  nextRenewalDate?: string;
};

/**
 * POST /subscriptions/:id/pause
 * Pause active billing on a subscription.
 */
router.post(
  "/subscriptions/:id/pause",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      if (!id || typeof id !== "string") {
        sendError(res, "INVALID_SUBSCRIPTION_ID", "Subscription ID is required", 400);
        return;
      }

      const subscription = subscriptions.get(id);

      if (!subscription) {
        sendError(res, "SUBSCRIPTION_NOT_FOUND", "Subscription not found", 404);
        return;
      }

      if (subscription.status === "cancelled") {
        sendError(res, "SUBSCRIPTION_CANCELLED", "Cannot pause a cancelled subscription", 400);
        return;
      }

      if (subscription.status === "paused") {
        sendError(res, "SUBSCRIPTION_ALREADY_PAUSED", "Subscription is already paused", 400);
        return;
      }

      // Pause the subscription
      subscription.status = "paused";
      subscription.pausedAt = new Date().toISOString();

      // Emit webhook event
      const webhookEvent = {
        event: "subscription.paused",
        subscriptionId: id,
        timestamp: new Date().toISOString(),
      };
      emittedWebhooks.push(webhookEvent);

      return res.status(200).json({
        success: true,
        data: subscription,
      });
    } catch (err) {
      return next(err);
    }
  },
);

// Export for testing
export function __getSubscriptions(): Map<string, Subscription> {
  return subscriptions;
}

export function __getEmittedWebhooks(): Array<{ event: string; subscriptionId: string; timestamp: string }> {
  return emittedWebhooks;
}

export function __resetSubscriptions(): void {
  subscriptions.clear();
  emittedWebhooks.length = 0;
}

export function __seedSubscription(subscription: Subscription): void {
  subscriptions.set(subscription.id, subscription);
}

export default router;
