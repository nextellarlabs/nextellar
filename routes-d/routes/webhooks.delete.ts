import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

// In-memory storage for webhooks (mock database)
const webhooks = new Map<string, Webhook>();
const auditEvents: Array<{ action: string; webhookId: string; userId: string; timestamp: string }> = [];

type Webhook = {
  id: string;
  url: string;
  userId: string;
  events: string[];
  createdAt: string;
};

/**
 * DELETE /webhooks/:id
 * Delete a webhook subscription.
 */
router.delete(
  "/webhooks/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      if (!id || typeof id !== "string") {
        sendError(res, "INVALID_WEBHOOK_ID", "Webhook ID is required", 400);
        return;
      }

      const webhook = webhooks.get(id);

      if (!webhook) {
        sendError(res, "WEBHOOK_NOT_FOUND", "Webhook not found", 404);
        return;
      }

      // In a real application, we would get the userId from authentication
      // For this mock, we'll check if the userId is provided in the request body
      const requestingUserId = req.body?.userId;

      if (!requestingUserId || typeof requestingUserId !== "string") {
        sendError(res, "UNAUTHORIZED", "User authentication required", 401);
        return;
      }

      // Restrict to the owning user
      if (webhook.userId !== requestingUserId) {
        sendError(res, "FORBIDDEN", "You do not have permission to delete this webhook", 403);
        return;
      }

      // Delete the webhook
      webhooks.delete(id);

      // Emit audit event
      const auditEvent = {
        action: "webhook.deleted",
        webhookId: id,
        userId: requestingUserId,
        timestamp: new Date().toISOString(),
      };
      auditEvents.push(auditEvent);

      return res.status(200).json({
        success: true,
        message: "Webhook deleted successfully",
      });
    } catch (err) {
      return next(err);
    }
  },
);

// Export for testing
export function __getWebhooks(): Map<string, Webhook> {
  return webhooks;
}

export function __getAuditEvents(): Array<{ action: string; webhookId: string; userId: string; timestamp: string }> {
  return auditEvents;
}

export function __resetWebhooks(): void {
  webhooks.clear();
  auditEvents.length = 0;
}

export function __seedWebhook(webhook: Webhook): void {
  webhooks.set(webhook.id, webhook);
}

export default router;
