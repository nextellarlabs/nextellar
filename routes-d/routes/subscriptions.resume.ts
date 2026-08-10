import { Router, Response, NextFunction } from "express";
import { authenticate, AuthenticatedRequest } from "../../backend/middleware/auth.js";
import { sendError } from "../../backend/utils/response.js";

const router = Router();

type SubscriptionStatus = "active" | "paused" | "cancelled" | "expired";

interface Subscription {
  id: string;
  userId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  pausedAt?: Date;
}

interface WebhookEvent {
  type: string;
  subscriptionId: string;
  timestamp: Date;
}

// Mock storage for subscriptions
const subscriptions = new Map<string, Subscription>();
const webhookEvents: WebhookEvent[] = [];

/**
 * Recalculate the next renewal date based on the subscription's billing cycle.
 * For this implementation, we'll add 30 days to the current date.
 */
function calculateNextRenewalDate(): Date {
  const now = new Date();
  return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
}

/**
 * Emit a webhook event for subscription resumption.
 */
function emitWebhook(subscriptionId: string): void {
  const event: WebhookEvent = {
    type: "subscription.resumed",
    subscriptionId,
    timestamp: new Date(),
  };
  webhookEvents.push(event);
  console.log(`[WEBHOOK] ${JSON.stringify(event)}`);
}

/**
 * POST /subscriptions/:id/resume
 * Resume a paused subscription.
 * Recalculates the next renewal date and emits a webhook.
 * Rejects when the subscription is not paused.
 */
router.post(
  "/:id/resume",
  authenticate,
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.user?.sub;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "User not authenticated", 401);
        return;
      }

      const subscription = subscriptions.get(id);

      if (!subscription) {
        sendError(res, "NOT_FOUND", "Subscription not found", 404);
        return;
      }

      // Check if the user owns this subscription
      if (subscription.userId !== userId) {
        sendError(res, "FORBIDDEN", "You do not have access to this subscription", 403);
        return;
      }

      // Reject when the subscription is not paused
      if (subscription.status !== "paused") {
        sendError(
          res,
          "INVALID_STATE",
          `Cannot resume subscription with status: ${subscription.status}`,
          400
        );
        return;
      }

      // Update subscription status and recalculate renewal date
      subscription.status = "active";
      subscription.currentPeriodEnd = calculateNextRenewalDate();
      delete subscription.pausedAt;

      // Emit webhook event
      emitWebhook(id);

      res.status(200).json({
        success: true,
        data: {
          id: subscription.id,
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
export { subscriptions, webhookEvents };
