import { randomBytes, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  type WebhookSubscription,
  type WebhookSubscriptionStore,
  toPublicSubscription,
} from "../lib/webhookDispatcher.js";

export interface WebhooksSubscribeRouterOptions {
  store: WebhookSubscriptionStore;
  now?: () => Date;
  nextId?: () => string;
  nextSecret?: () => string;
}

const STELLAR_ACCOUNT_RE = /^G[A-Z2-7]{55}$/;

function parseUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function parseAccountId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const accountId = value.trim();
  return STELLAR_ACCOUNT_RE.test(accountId) ? accountId : undefined;
}

function parseSecret(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const secret = value.trim();
  return secret.length >= 16 ? secret : undefined;
}

export function createWebhooksSubscribeRouter(
  options: WebhooksSubscribeRouterOptions,
): Router {
  const router = Router();
  const now = options.now ?? (() => new Date());
  const nextId = options.nextId ?? (() => randomUUID());
  const nextSecret =
    options.nextSecret ?? (() => randomBytes(32).toString("base64url"));

  router.post("/", async (req: Request, res: Response) => {
    const accountId = parseAccountId(req.body?.accountId);
    if (!accountId) {
      res.status(400).json({ ok: false, error: "accountId must be a Stellar account ID" });
      return;
    }

    const url = parseUrl(req.body?.url);
    if (!url) {
      res.status(400).json({ ok: false, error: "url must be a valid HTTPS URL" });
      return;
    }

    const providedSecret = parseSecret(req.body?.secret);
    if (req.body?.secret !== undefined && !providedSecret) {
      res.status(400).json({ ok: false, error: "secret must be at least 16 characters" });
      return;
    }

    const secret = providedSecret ?? nextSecret();
    const subscription: WebhookSubscription = {
      id: nextId(),
      accountId,
      url,
      secret,
      createdAt: now().toISOString(),
    };

    await options.store.save(subscription);

    res.status(201).json({
      ok: true,
      subscription: toPublicSubscription(subscription),
      secret: providedSecret ? undefined : secret,
    });
  });

  return router;
}
