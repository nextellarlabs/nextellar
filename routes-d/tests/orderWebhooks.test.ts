// Tests for the order fulfillment webhook publisher (#305). Covers
// emit, signature verification, and retry-with-backoff behaviour.

import {
  OrderWebhookDispatcher,
  WEBHOOK_HEADERS,
  isEmittableEvent,
  signPayload,
  verifySignature,
  type FetchLike,
  type OrderWebhookPayload,
} from "../lib/orderWebhooks.js";

function payload(overrides: Partial<OrderWebhookPayload> = {}): OrderWebhookPayload {
  return {
    event: "order.fulfilled",
    orderId: "1",
    occurredAt: 1700000000000,
    data: { customer: "alice" },
    ...overrides,
  };
}

describe("signPayload / verifySignature", () => {
  it("verifies a freshly signed body", () => {
    const body = JSON.stringify(payload());
    const sig = signPayload("topsecret", body);
    expect(verifySignature("topsecret", body, sig)).toBe(true);
  });

  it("rejects a body when the signature was forged for a different body", () => {
    const sig = signPayload("topsecret", JSON.stringify(payload()));
    expect(verifySignature("topsecret", JSON.stringify(payload({ orderId: "2" })), sig)).toBe(false);
  });

  it("rejects when the secret differs", () => {
    const body = JSON.stringify(payload());
    const sig = signPayload("topsecret", body);
    expect(verifySignature("wrong", body, sig)).toBe(false);
  });

  it("rejects malformed signatures", () => {
    const body = JSON.stringify(payload());
    expect(verifySignature("topsecret", body, "not-hex")).toBe(false);
    expect(verifySignature("topsecret", body, "")).toBe(false);
  });
});

describe("isEmittableEvent", () => {
  it("accepts the two events the issue calls out", () => {
    expect(isEmittableEvent("order.fulfilled")).toBe(true);
    expect(isEmittableEvent("order.shipped")).toBe(true);
  });
  it("rejects unrelated events", () => {
    expect(isEmittableEvent("order.cancelled")).toBe(false);
    expect(isEmittableEvent("")).toBe(false);
  });
});

describe("OrderWebhookDispatcher.dispatch", () => {
  it("signs the body with HMAC-SHA256 and sends the event header", async () => {
    const seen: { headers: Record<string, string>; body: string }[] = [];
    const fetcher: FetchLike = async (_url, init) => {
      seen.push({ headers: init.headers, body: init.body });
      return { ok: true, status: 200 };
    };
    const d = new OrderWebhookDispatcher("https://example.test/hook", "shh", { fetcher });
    const p = payload();
    const result = await d.dispatch(p);

    expect(result).toEqual({ ok: true, attempts: 1, lastStatus: 200 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers[WEBHOOK_HEADERS.event]).toBe("order.fulfilled");
    const sig = seen[0]!.headers[WEBHOOK_HEADERS.signature]!;
    expect(verifySignature("shh", seen[0]!.body, sig)).toBe(true);
  });

  it("retries on 5xx and succeeds on a later attempt", async () => {
    let attempt = 0;
    const fetcher: FetchLike = async () => {
      attempt += 1;
      if (attempt < 3) return { ok: false, status: 503 };
      return { ok: true, status: 200 };
    };
    const sleep = jest.fn(async () => {});
    const d = new OrderWebhookDispatcher("https://example.test/hook", "shh", {
      fetcher,
      sleep,
      maxAttempts: 5,
      baseDelayMs: 10,
      maxDelayMs: 100,
    });
    const result = await d.dispatch(payload());
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    // Backoff doubles: 10, 20, ...
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(10);
    expect(sleep.mock.calls[1][0]).toBeGreaterThanOrEqual(20);
  });

  it("gives up after maxAttempts on persistent 5xx", async () => {
    const fetcher: FetchLike = async () => ({ ok: false, status: 503 });
    const d = new OrderWebhookDispatcher("https://example.test/hook", "shh", {
      fetcher,
      sleep: async () => {},
      maxAttempts: 3,
      baseDelayMs: 1,
    });
    const result = await d.dispatch(payload());
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.lastStatus).toBe(503);
  });

  it("does NOT retry on 4xx (except 429) — fast-fail on misconfiguration", async () => {
    const fetcher = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () => ({
      ok: false,
      status: 400,
    }));
    const d = new OrderWebhookDispatcher("https://example.test/hook", "shh", {
      fetcher: fetcher as unknown as FetchLike,
      sleep: async () => {},
      maxAttempts: 5,
    });
    const result = await d.dispatch(payload());
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("DOES retry on 429 (rate limit)", async () => {
    let attempt = 0;
    const fetcher: FetchLike = async () => {
      attempt += 1;
      return { ok: false, status: 429 };
    };
    const d = new OrderWebhookDispatcher("https://example.test/hook", "shh", {
      fetcher,
      sleep: async () => {},
      maxAttempts: 3,
    });
    const result = await d.dispatch(payload());
    expect(attempt).toBe(3);
    expect(result.ok).toBe(false);
  });

  it("records transport errors and retries", async () => {
    let attempt = 0;
    const fetcher: FetchLike = async () => {
      attempt += 1;
      if (attempt < 2) throw new Error("ECONNREFUSED");
      return { ok: true, status: 200 };
    };
    const d = new OrderWebhookDispatcher("https://example.test/hook", "shh", {
      fetcher,
      sleep: async () => {},
      maxAttempts: 3,
    });
    const result = await d.dispatch(payload());
    expect(result.ok).toBe(true);
    expect(attempt).toBe(2);
  });
});
