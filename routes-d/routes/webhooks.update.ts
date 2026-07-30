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

type WebhookUpdate = {
  url?: string;
  sharedSecret?: string;
  events?: string[];
};

type AuditEvent = {
  action: string;
  webhookId: string;
  userId: string;
  changedFields: string[];
  timestamp: string;
};

type MaskedWebhook = Omit<Webhook, "sharedSecret"> & { sharedSecret: string };

const webhooks = new Map<string, Webhook>();
const auditEvents: AuditEvent[] = [];

function maskSecret(secret: string): string {
  if (secret.length <= 4) return "****";
  return secret.slice(0, 4) + "****";
}

function isValidWebhookUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitizeEvents(events: string[]): string[] {
  return Array.from(new Set(events.map((event) => event.trim())));
}

function toResponseWebhook(webhook: Webhook): MaskedWebhook {
  return {
    ...webhook,
    sharedSecret: maskSecret(webhook.sharedSecret),
  };
}

/**
 * PATCH /webhooks/:id
 * Update a webhook subscription owned by the authenticated user.
 */
router.patch(
  "/webhooks/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.body?.userId || (req.headers["x-user-id"] as string | undefined);
      const body = req.body as WebhookUpdate & { userId?: string };

      if (!userId || typeof userId !== "string") {
        sendError(res, "UNAUTHORIZED", "User authentication required", 401);
        return;
      }

      if (!id || typeof id !== "string") {
        sendError(res, "INVALID_WEBHOOK_ID", "Webhook ID is required", 400);
        return;
      }

      const webhook = webhooks.get(id);
      if (!webhook) {
        sendError(res, "WEBHOOK_NOT_FOUND", "Webhook not found", 404);
        return;
      }

      if (webhook.userId !== userId) {
        sendError(res, "FORBIDDEN", "You do not have permission to update this webhook", 403);
        return;
      }

      if (body.url !== undefined) {
        if (typeof body.url !== "string" || body.url.trim() === "" || !isValidWebhookUrl(body.url.trim())) {
          sendError(res, "INVALID_URL", "url must be a valid http or https URL", 400);
          return;
        }
      }

      if (body.sharedSecret !== undefined) {
        if (typeof body.sharedSecret !== "string" || body.sharedSecret.trim() === "") {
          sendError(res, "INVALID_SHARED_SECRET", "sharedSecret must be a non-empty string", 400);
          return;
        }
      }

      if (body.events !== undefined) {
        if (!Array.isArray(body.events) || body.events.length === 0) {
          sendError(res, "INVALID_EVENTS", "events must be a non-empty array of strings", 400);
          return;
        }

        const invalidEvent = body.events.some((event) => typeof event !== "string" || event.trim() === "");
        if (invalidEvent) {
          sendError(res, "INVALID_EVENTS", "events must be a non-empty array of strings", 400);
          return;
        }
      }

      const changedFields: string[] = [];

      if (body.url !== undefined) {
        const nextUrl = body.url.trim();
        if (nextUrl !== webhook.url) {
          webhook.url = nextUrl;
          changedFields.push("url");
        }
      }

      if (body.sharedSecret !== undefined) {
        const nextSecret = body.sharedSecret.trim();
        if (nextSecret !== webhook.sharedSecret) {
          webhook.sharedSecret = nextSecret;
          changedFields.push("sharedSecret");
        }
      }

      if (body.events !== undefined) {
        const nextEvents = sanitizeEvents(body.events);
        const unchanged = nextEvents.length === webhook.events.length && nextEvents.every((event, index) => event === webhook.events[index]);
        if (!unchanged) {
          webhook.events = nextEvents;
          changedFields.push("events");
        }
      }

      if (changedFields.length > 0) {
        auditEvents.push({
          action: "webhook.updated",
          webhookId: webhook.id,
          userId,
          changedFields,
          timestamp: new Date().toISOString(),
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          updated: changedFields.length > 0,
          webhook: toResponseWebhook(webhook),
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __seedWebhook(webhook: Webhook): void {
  webhooks.set(webhook.id, { ...webhook, events: [...webhook.events] });
}

export function __resetWebhooks(): void {
  webhooks.clear();
  auditEvents.length = 0;
}

export function __getWebhooks(): Map<string, Webhook> {
  return webhooks;
}

export function __getAuditEvents(): AuditEvent[] {
  return auditEvents;
}

export default router;