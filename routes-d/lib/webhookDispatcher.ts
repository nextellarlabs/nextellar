import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const STELLAR_TRANSACTION_CONFIRMED_EVENT =
  "stellar.transaction.confirmed" as const;

const SIGNATURE_HEADER = "X-Nextellar-Signature";
const TIMESTAMP_HEADER = "X-Nextellar-Timestamp";
const EVENT_HEADER = "X-Nextellar-Event";
const DELIVERY_HEADER = "X-Nextellar-Delivery";

export const WEBHOOK_DISPATCHER_HEADERS = Object.freeze({
  signature: SIGNATURE_HEADER,
  timestamp: TIMESTAMP_HEADER,
  event: EVENT_HEADER,
  delivery: DELIVERY_HEADER,
});

export interface StellarConfirmedTransaction {
  hash: string;
  ledger: number;
  createdAt: string;
  sourceAccount: string;
  successful: true;
  feeCharged?: string;
  pagingToken?: string;
  memo?: string;
  envelopeXdr?: string;
  resultXdr?: string;
}

export interface StellarTransactionWebhookPayload {
  event: typeof STELLAR_TRANSACTION_CONFIRMED_EVENT;
  accountId: string;
  occurredAt: string;
  transaction: StellarConfirmedTransaction;
}

export interface WebhookSubscription {
  id: string;
  accountId: string;
  url: string;
  secret: string;
  createdAt: string;
}

export interface PublicWebhookSubscription {
  id: string;
  accountId: string;
  url: string;
  createdAt: string;
}

export interface WebhookSubscriptionStore {
  save(subscription: WebhookSubscription): Promise<void>;
  listByAccount(accountId: string): Promise<WebhookSubscription[]>;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponseLike>;

export interface WebhookDispatchOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  fetcher?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  nextDeliveryId?: () => string;
}

export interface WebhookDispatchResult {
  ok: boolean;
  subscriptionId: string;
  attempts: number;
  lastStatus?: number;
  lastError?: string;
}

export interface AccountDispatchResult {
  accountId: string;
  delivered: number;
  failed: number;
  results: WebhookDispatchResult[];
}

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 8_000;
const MAX_ATTEMPTS_LIMIT = 10;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const defaultFetcher: FetchLike = async (url, init) => {
  const response = await fetch(url, init);
  return { ok: response.ok, status: response.status };
};

export function toPublicSubscription(
  subscription: WebhookSubscription,
): PublicWebhookSubscription {
  return {
    id: subscription.id,
    accountId: subscription.accountId,
    url: subscription.url,
    createdAt: subscription.createdAt,
  };
}

export function createInMemoryWebhookSubscriptionStore(): WebhookSubscriptionStore {
  const byAccount = new Map<string, Map<string, WebhookSubscription>>();

  return {
    async save(subscription: WebhookSubscription): Promise<void> {
      const accountSubscriptions =
        byAccount.get(subscription.accountId) ?? new Map<string, WebhookSubscription>();
      accountSubscriptions.set(subscription.id, subscription);
      byAccount.set(subscription.accountId, accountSubscriptions);
    },

    async listByAccount(accountId: string): Promise<WebhookSubscription[]> {
      return Array.from(byAccount.get(accountId)?.values() ?? []);
    },
  };
}

export function signWebhookPayload(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }

  const expected = Buffer.from(
    signWebhookPayload(secret, timestamp, body),
    "hex",
  );
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function buildStellarTransactionPayload(params: {
  accountId: string;
  transaction: StellarConfirmedTransaction;
}): StellarTransactionWebhookPayload {
  if (params.transaction.successful !== true) {
    throw new Error("only successful Stellar transactions can be dispatched");
  }

  return {
    event: STELLAR_TRANSACTION_CONFIRMED_EVENT,
    accountId: params.accountId,
    occurredAt: params.transaction.createdAt,
    transaction: params.transaction,
  };
}

function normalizeAttempts(value: number | undefined): number {
  const attempts = value ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > MAX_ATTEMPTS_LIMIT) {
    throw new Error(`maxAttempts must be an integer between 1 and ${MAX_ATTEMPTS_LIMIT}`);
  }
  return attempts;
}

function retryDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export class StellarWebhookDispatcher {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly fetcher: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly nextDeliveryId: () => string;

  constructor(
    private readonly store: WebhookSubscriptionStore,
    options: WebhookDispatchOptions = {},
  ) {
    this.maxAttempts = normalizeAttempts(options.maxAttempts);
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.fetcher = options.fetcher ?? defaultFetcher;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => Date.now());
    this.nextDeliveryId = options.nextDeliveryId ?? (() => randomUUID());

    if (this.baseDelayMs < 0 || this.maxDelayMs < this.baseDelayMs) {
      throw new Error("backoff delays must be non-negative and ordered");
    }
  }

  async dispatchToSubscription(
    subscription: WebhookSubscription,
    payload: StellarTransactionWebhookPayload,
  ): Promise<WebhookDispatchResult> {
    const body = JSON.stringify(payload);
    const timestamp = String(this.now());
    const signature = signWebhookPayload(subscription.secret, timestamp, body);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      [SIGNATURE_HEADER]: signature,
      [TIMESTAMP_HEADER]: timestamp,
      [EVENT_HEADER]: payload.event,
      [DELIVERY_HEADER]: this.nextDeliveryId(),
    };

    let lastStatus: number | undefined;
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetcher(subscription.url, {
          method: "POST",
          headers,
          body,
        });
        lastStatus = response.status;
        lastError = undefined;

        if (response.ok) {
          return {
            ok: true,
            subscriptionId: subscription.id,
            attempts: attempt,
            lastStatus,
          };
        }

        if (!shouldRetryStatus(response.status)) {
          return {
            ok: false,
            subscriptionId: subscription.id,
            attempts: attempt,
            lastStatus,
          };
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }

      if (attempt < this.maxAttempts) {
        await this.sleep(retryDelayMs(attempt, this.baseDelayMs, this.maxDelayMs));
      }
    }

    return {
      ok: false,
      subscriptionId: subscription.id,
      attempts: this.maxAttempts,
      lastStatus,
      lastError,
    };
  }

  async dispatchConfirmedTransaction(params: {
    accountId: string;
    transaction: StellarConfirmedTransaction;
  }): Promise<AccountDispatchResult> {
    const payload = buildStellarTransactionPayload(params);
    const subscriptions = await this.store.listByAccount(params.accountId);
    const results = await Promise.all(
      subscriptions.map((subscription) =>
        this.dispatchToSubscription(subscription, payload),
      ),
    );

    const delivered = results.filter((result) => result.ok).length;
    return {
      accountId: params.accountId,
      delivered,
      failed: results.length - delivered,
      results,
    };
  }
}
