// Order fulfillment webhook publisher (#305).
//
// Signs payloads with HMAC-SHA256 and retries with exponential backoff
// + jitter. Two transports:
//   - `dispatch(...)` — fire one webhook and report the outcome
//   - `OrderWebhookDispatcher` — small class that keeps the secret,
//     max-attempt budget, and an injected `fetch` for tests
//
// Network I/O is pluggable so tests can drive the retry loop without a
// real HTTP server.

import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookEvent = "order.fulfilled" | "order.shipped";

export interface OrderWebhookPayload {
  event: WebhookEvent;
  orderId: string;
  occurredAt: number;
  data: Record<string, unknown>;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponseLike>;

export interface DispatchOptions {
  /** Maximum total attempts (initial + retries). Default 4. */
  maxAttempts?: number;
  /** Base delay between retries in ms. Default 250. */
  baseDelayMs?: number;
  /** Max delay cap, ms. Default 8000. */
  maxDelayMs?: number;
  /** Override sleep for tests; default `setTimeout` resolver. */
  sleep?: (ms: number) => Promise<void>;
  /** Override fetch for tests. */
  fetcher?: FetchLike;
  /** Per-attempt jitter factor (0..1) applied to the backoff. Default
   *  0 in tests for determinism; pick `Math.random` in prod. */
  jitter?: () => number;
}

export interface DispatchResult {
  ok: boolean;
  attempts: number;
  lastStatus?: number;
  lastError?: string;
}

const SIGNATURE_HEADER = "X-Nextellar-Signature";
const EVENT_HEADER = "X-Nextellar-Event";

export function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifySignature(secret: string, body: string, signature: string): boolean {
  if (typeof signature !== "string") return false;
  const expected = signPayload(secret, body);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const defaultFetcher: FetchLike = async (url, init) => {
  const resp = await fetch(url, init);
  return { ok: resp.ok, status: resp.status };
};

function backoff(attempt: number, base: number, max: number, jitter: number): number {
  // attempt is 0-indexed: 0 is the FIRST retry after a failure.
  const grow = Math.min(max, base * 2 ** attempt);
  return Math.floor(grow * (1 + jitter));
}

export class OrderWebhookDispatcher {
  constructor(
    private readonly endpoint: string,
    private readonly secret: string,
    private readonly options: DispatchOptions = {},
  ) {}

  /** Dispatch a single webhook with retry on transient failures. */
  async dispatch(payload: OrderWebhookPayload): Promise<DispatchResult> {
    const maxAttempts = this.options.maxAttempts ?? 4;
    const baseDelay = this.options.baseDelayMs ?? 250;
    const maxDelay = this.options.maxDelayMs ?? 8000;
    const sleep = this.options.sleep ?? defaultSleep;
    const fetcher = this.options.fetcher ?? defaultFetcher;
    const jitter = this.options.jitter ?? (() => 0);

    const body = JSON.stringify(payload);
    const signature = signPayload(this.secret, body);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      [SIGNATURE_HEADER]: signature,
      [EVENT_HEADER]: payload.event,
    };

    let lastStatus: number | undefined;
    let lastError: string | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const resp = await fetcher(this.endpoint, { method: "POST", headers, body });
        lastStatus = resp.status;
        if (resp.ok) {
          return { ok: true, attempts: attempt, lastStatus };
        }
        // 4xx (except 429) is a client misconfiguration — don't retry.
        if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
          return { ok: false, attempts: attempt, lastStatus };
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (attempt < maxAttempts) {
        await sleep(backoff(attempt - 1, baseDelay, maxDelay, jitter()));
      }
    }
    return { ok: false, attempts: maxAttempts, lastStatus, lastError };
  }
}

/** Public dispatcher header constants for downstream verifiers. */
export const WEBHOOK_HEADERS = Object.freeze({
  signature: SIGNATURE_HEADER,
  event: EVENT_HEADER,
});

/** Convenience: only emit for the two events the issue calls out. */
export function isEmittableEvent(value: string): value is WebhookEvent {
  return value === "order.fulfilled" || value === "order.shipped";
}
