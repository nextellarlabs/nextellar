import { createHmac } from "node:crypto";
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
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

type DeliveryResult = {
  webhookId: string;
  responseCode: number;
  latencyMs: number;
  success: boolean;
  deliveredAt: string;
};

// In-memory webhook store shared with other webhook routes via seed helpers
const webhooks = new Map<string, Webhook>();

// Recorded test deliveries (for inspection in tests)
const testDeliveries: DeliveryResult[] = [];

export function buildSignature(secret: string, payload: string): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * POST /webhooks/:id/test
 * Send a test payload to the webhook destination for setup verification.
 * Signs the payload with HMAC-SHA256 using the webhook's sharedSecret,
 * identical to production delivery.
 * Returns the upstream HTTP response code and round-trip latency.
 */
router.post(
  "/webhooks/:id/test",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.body?.userId || (req.headers["x-user-id"] as string | undefined);

      if (!userId || typeof userId !== "string") {
        sendError(res, "UNAUTHORIZED", "User authentication required", 401);
        return;
      }

      const webhook = webhooks.get(id);
      if (!webhook) {
        sendError(res, "WEBHOOK_NOT_FOUND", "Webhook not found", 404);
        return;
      }

      if (webhook.userId !== userId) {
        sendError(res, "FORBIDDEN", "You do not have permission to test this webhook", 403);
        return;
      }

      const testPayload = JSON.stringify({
        type: "test",
        webhookId: id,
        timestamp: new Date().toISOString(),
      });

      const signature = buildSignature(webhook.sharedSecret, testPayload);
      const start = Date.now();

      let responseCode: number;
      try {
        const upstream = await fetch(webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Nextellar-Signature": signature,
          },
          body: testPayload,
          signal: AbortSignal.timeout(10_000),
        });
        responseCode = upstream.status;
      } catch {
        responseCode = 0;
      }

      const latencyMs = Date.now() - start;
      const success = responseCode >= 200 && responseCode < 300;
      const deliveredAt = new Date().toISOString();

      const result: DeliveryResult = { webhookId: id, responseCode, latencyMs, success, deliveredAt };
      testDeliveries.push(result);

      return res.status(200).json({
        success: true,
        data: { responseCode, latencyMs, success, deliveredAt },
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
  testDeliveries.length = 0;
}

export function __getTestDeliveries(): DeliveryResult[] {
  return testDeliveries;
}

export default router;
