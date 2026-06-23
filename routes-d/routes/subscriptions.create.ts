import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

// In-memory storage for subscriptions (mock database)
const subscriptions = new Map<string, Subscription>();
const idempotencyKeys = new Set<string>();

type Subscription = {
  id: string;
  planId: string;
  billingInterval: "monthly" | "yearly";
  startDate: string;
  userId: string;
  status: "active" | "paused" | "cancelled";
  createdAt: string;
};

type CreateSubscriptionBody = {
  planId: string;
  billingInterval: "monthly" | "yearly";
  startDate: string;
  userId: string;
  idempotencyKey?: string;
};

/**
 * POST /subscriptions
 * Create a recurring subscription billed in Stellar assets.
 */
router.post(
  "/subscriptions",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as CreateSubscriptionBody;

      // Validate required fields
      if (!body.planId || typeof body.planId !== "string") {
        sendError(res, "INVALID_PLAN_ID", "planId is required and must be a string", 400);
        return;
      }

      if (
        !body.billingInterval ||
        (body.billingInterval !== "monthly" && body.billingInterval !== "yearly")
      ) {
        sendError(
          res,
          "INVALID_BILLING_INTERVAL",
          "billingInterval must be 'monthly' or 'yearly'",
          400,
        );
        return;
      }

      if (!body.startDate || typeof body.startDate !== "string") {
        sendError(res, "INVALID_START_DATE", "startDate is required and must be a string", 400);
        return;
      }

      // Validate startDate is a valid ISO date
      const startDate = new Date(body.startDate);
      if (isNaN(startDate.getTime())) {
        sendError(res, "INVALID_START_DATE", "startDate must be a valid ISO date", 400);
        return;
      }

      if (!body.userId || typeof body.userId !== "string") {
        sendError(res, "INVALID_USER_ID", "userId is required and must be a string", 400);
        return;
      }

      // Idempotency check
      if (body.idempotencyKey) {
        if (idempotencyKeys.has(body.idempotencyKey)) {
          // Return existing subscription for this idempotency key
          for (const [id, sub] of subscriptions.entries()) {
            if (sub.userId === body.userId && sub.planId === body.planId) {
              return res.status(200).json({
                success: true,
                data: sub,
                idempotent: true,
              });
            }
          }
          sendError(res, "IDEMPOTENCY_CONFLICT", "Idempotency key was used but no matching subscription found", 409);
          return;
        }
        idempotencyKeys.add(body.idempotencyKey);
      }

      // Create subscription
      const subscriptionId = `sub-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const subscription: Subscription = {
        id: subscriptionId,
        planId: body.planId,
        billingInterval: body.billingInterval,
        startDate: body.startDate,
        userId: body.userId,
        status: "active",
        createdAt: new Date().toISOString(),
      };

      subscriptions.set(subscriptionId, subscription);

      return res.status(201).json({
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

export function __resetSubscriptions(): void {
  subscriptions.clear();
  idempotencyKeys.clear();
}

export default router;
