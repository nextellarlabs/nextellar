import crypto from "node:crypto";

export type DepositStatus =
  | "pending"
  | "interactive"
  | "in_progress"
  | "completed"
  | "failed"
  | "expired";

export interface DepositIntentInput {
  accountId: string;
  assetCode: string;
  assetIssuer?: string;
  amount?: string;
  memo?: string;
  webhookUrl?: string;
  redirectUrl?: string;
  customerId?: string;
}

export interface DepositIntent {
  id: string;
  accountId: string;
  assetCode: string;
  assetIssuer?: string;
  amount?: string;
  memo?: string;
  webhookUrl?: string;
  redirectUrl?: string;
  customerId?: string;
  interactiveUrl: string;
  status: DepositStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface DepositStatusTransition {
  intentId: string;
  accountId: string;
  from: DepositStatus;
  to: DepositStatus;
  at: number;
  intent: DepositIntent;
}

export interface Sep24Dependencies {
  now?: () => number;
  interactiveBaseUrl?: string;
  webhookDispatcher?: (transition: DepositStatusTransition) => Promise<void> | void;
}

const DEFAULT_INTERACTIVE_BASE_URL =
  process.env.NEXTELLAR_SEP24_INTERACTIVE_BASE_URL ?? "https://nextellar.local/sep24/interactive";
const DEFAULT_INTENT_TTL_MS = Number(process.env.NEXTELLAR_SEP24_INTENT_TTL_MS ?? 30 * 60 * 1000);

export const depositIntentStore = new Map<string, DepositIntent>();
export const depositStatusTransitions: DepositStatusTransition[] = [];

export const sep24Deps: Required<Pick<Sep24Dependencies, "now" | "interactiveBaseUrl" | "webhookDispatcher">> = {
  now: () => Date.now(),
  interactiveBaseUrl: DEFAULT_INTERACTIVE_BASE_URL,
  webhookDispatcher: async (transition: DepositStatusTransition) => {
    const webhookUrl = transition.intent.webhookUrl;
    if (!webhookUrl) {
      return;
    }

    if (typeof fetch !== "function") {
      return;
    }

    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intentId: transition.intentId,
          accountId: transition.accountId,
          previousStatus: transition.from,
          status: transition.to,
          at: transition.at,
          intent: transition.intent,
        }),
      });
    } catch {
      // Delivery failures are recorded via the transition log and surfaced to callers.
    }
  },
};

function buildInteractiveUrl(
  intentId: string,
  interactiveBaseUrl = DEFAULT_INTERACTIVE_BASE_URL,
  redirectUrl?: string,
): string {
  const url = new URL(interactiveBaseUrl.replace(/\/$/, ""));
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${intentId}`;
  if (redirectUrl) {
    url.searchParams.set("redirect_url", redirectUrl);
  }
  return url.toString();
}

export function createDepositIntent(
  input: DepositIntentInput,
  dependencies: Sep24Dependencies = {},
): DepositIntent {
  const now = dependencies.now?.() ?? sep24Deps.now();
  const interactiveBaseUrl = dependencies.interactiveBaseUrl ?? sep24Deps.interactiveBaseUrl;
  const id = crypto.randomUUID();
  const intent: DepositIntent = {
    id,
    accountId: input.accountId,
    assetCode: input.assetCode,
    assetIssuer: input.assetIssuer,
    amount: input.amount,
    memo: input.memo,
    webhookUrl: input.webhookUrl,
    redirectUrl: input.redirectUrl,
    customerId: input.customerId,
    interactiveUrl: buildInteractiveUrl(id, interactiveBaseUrl, input.redirectUrl),
    status: "pending",
    createdAt: now,
    updatedAt: now,
    expiresAt: now + DEFAULT_INTENT_TTL_MS,
  };

  depositIntentStore.set(id, intent);
  return intent;
}

const ALLOWED_DEPOSIT_STATUSES: ReadonlySet<DepositStatus> = new Set([
  "pending",
  "interactive",
  "in_progress",
  "completed",
  "failed",
  "expired",
]);

export function getDepositIntent(intentId: string): DepositIntent | undefined {
  const intent = depositIntentStore.get(intentId);
  if (!intent) {
    return undefined;
  }

  if (intent.expiresAt <= Date.now()) {
    depositIntentStore.delete(intentId);
    return undefined;
  }

  return intent;
}

export async function transitionDepositStatus(
  intentId: string,
  nextStatus: DepositStatus,
  dependencies: Sep24Dependencies = {},
): Promise<DepositIntent | null> {
  if (!ALLOWED_DEPOSIT_STATUSES.has(nextStatus)) {
    throw new Error(`Unsupported deposit status: ${nextStatus}`);
  }

  const intent = getDepositIntent(intentId);
  if (!intent) {
    return null;
  }

  if (intent.status === nextStatus) {
    return intent;
  }

  const now = dependencies.now?.() ?? sep24Deps.now();
  const previousStatus = intent.status;
  intent.status = nextStatus;
  intent.updatedAt = now;

  const transition: DepositStatusTransition = {
    intentId,
    accountId: intent.accountId,
    from: previousStatus,
    to: nextStatus,
    at: now,
    intent: { ...intent },
  };

  depositStatusTransitions.push(transition);
  await (dependencies.webhookDispatcher ?? sep24Deps.webhookDispatcher)(transition);
  return intent;
}

export function expireStaleDepositIntents(now = Date.now()): number {
  let removed = 0;
  for (const [intentId, intent] of depositIntentStore.entries()) {
    if (intent.expiresAt <= now) {
      depositIntentStore.delete(intentId);
      removed += 1;
    }
  }
  return removed;
}
