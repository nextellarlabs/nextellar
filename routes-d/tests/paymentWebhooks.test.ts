// Tests for the payment status webhook publisher. Covers
// emit, signature verification, and retry-with-backoff behaviour.

import { jest } from "@jest/globals";
import {
  PaymentWebhookDispatcher,
  WEBHOOK_HEADERS,
  isPaymentEvent,
  makePaymentEvent,
  signPayload,
  verifySignature,
  type FetchLike,
  type PaymentWebhookPayload,
} from "../lib/paymentWebhooks.js";

function payload(overrides: Partial<PaymentWebhookPayload> = {}): PaymentWebhookPayload {
  return {
    event: "payment.pending",
    paymentId: "pay_1",
    occurredAt: 1700000000000,
    data: { amount: 100 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("signPayload / verifySignature", () => {
  it("verifies a freshly signed body", () => {
    const body = JSON.stringify(payload());
    const sig = signPayload("topsecret", body);
    expect(verifySignature("topsecret", body, sig)).toBe(true);
  });

  it("rejects when the body differs", () => {
    const sig = signPayload("topsecret", JSON.stringify(payload()));
    expect(verifySignature("topsecret", JSON.stringify(payload({ paymentId: "pay_2" })), sig)).toBe(false);
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

describe("isPaymentEvent", () => {
  it("accepts all four payment statuses", () => {
    expect(isPaymentEvent("payment.pending")).toBe(true);
    expect(isPaymentEvent("payment.submitted")).toBe(true);
    expect(isPaymentEvent("payment.confirmed")).toBe(true);
    expect(isPaymentEvent("payment.failed")).toBe(true);
  });

  it("rejects unrelated events", () => {
    expect(isPaymentEvent("order.fulfilled")).toBe(false);
    expect(isPaymentEvent("payment.unknown")).toBe(false);
    expect(isPaymentEvent("")).toBe(false);
  });
});

describe("makePaymentEvent", () => {
  it("builds a payload with the correct event name", () => {
    const evt = makePaymentEvent("confirmed", "pay_42", { txHash: "abc" });
    expect(evt.event).toBe("payment.confirmed");
    expect(evt.paymentId).toBe("pay_42");
    expect(evt.data).toEqual({ txHash: "abc" });
    expect(typeof evt.occurredAt).toBe("number");
  });

  it("defaults data to an empty object", () => {
    const evt = makePaymentEvent("failed", "pay_99");
    expect(evt.data).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Dispatcher tests
// ---------------------------------------------------------------------------

describe("PaymentWebhookDispatcher.dispatch", () => {
  it("signs the body with HMAC-SHA256 and sends the event header", async () => {
    const seen: { headers: Record<string, string>; body: string }[] = [];
    const fetcher: FetchLike = async (_url, init) => {
      seen.push({ headers: init.headers, body: init.body });
      return { ok: true, status: 200 };
    };
    const d = new PaymentWebhookDispatcher("https://example.test/hook", "shh", { fetcher });
    const p = payload({ event: "payment.confirmed" });
    const result = await d.dispatch(p);

    expect(result).toEqual({ ok: true, attempts: 1, lastStatus: 200 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers[WEBHOOK_HEADERS.event]).toBe("payment.confirmed");
    const sig = seen[0]!.headers[WEBHOOK_HEADERS.signature]!;
    expect(verifySignature("shh", seen[0]!.body, sig)).toBe(true);
  });

  it("emits on each of the four payment status transitions", async () => {
    const statuses = ["payment.pending", "payment.submitted", "payment.confirmed", "payment.failed"] as const;
    for (const event of statuses) {
      const seen: string[] = [];
      const fetcher: FetchLike = async (_url, init) => {
        seen.push(init.headers[WEBHOOK_HEADERS.event]!);
        return { ok: true, status: 200 };
      };
      const d = new PaymentWebhookDispatcher("https://example.test/hook", "shh", { fetcher });
      const result = await d.dispatch(payload({ event }));
      expect(result.ok).toBe(true);
      expect(seen[0]).toBe(event);
    }
  });

  it("retries on 5xx and succeeds on a later attempt", async () => {
    let attempt = 0;
    const fetcher: FetchLike = async () => {
      attempt += 1;
      if (attempt < 3) return { ok: false, status: 503 };
      return { ok: true, status: 200 };
    };
    const sleep = jest.fn(async () => {});
    const d = new PaymentWebhookDispatcher("https://example.test/hook", "shh", {
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
    expect((sleep.mock.calls[0] as unknown as [number])[0]).toBeGreaterThanOrEqual(10);
    expect((sleep.mock.calls[1] as unknown as [number])[0]).toBeGreaterThanOrEqual(20);
  });

  it("gives up after maxAttempts on persistent 5xx", async () => {
    const fetcher: FetchLike = async () => ({ ok: false, status: 503 });
    const d = new PaymentWebhookDispatcher("https://example.test/hook", "shh", {
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
    const fetcherMock = jest.fn(async () => ({
      ok: false as const,
      status: 400,
    }));
    const fetcher = fetcherMock as unknown as FetchLike;
    const d = new PaymentWebhookDispatcher("https://example.test/hook", "shh", {
      fetcher,
      sleep: async () => {},
      maxAttempts: 5,
    });
    const result = await d.dispatch(payload());
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fetcherMock).toHaveBeenCalledTimes(1);
  });

  it("DOES retry on 429 (rate limit)", async () => {
    let attempt = 0;
    const fetcher: FetchLike = async () => {
      attempt += 1;
      return { ok: false, status: 429 };
    };
    const d = new PaymentWebhookDispatcher("https://example.test/hook", "shh", {
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
    const d = new PaymentWebhookDispatcher("https://example.test/hook", "shh", {
      fetcher,
      sleep: async () => {},
      maxAttempts: 3,
    });
    const result = await d.dispatch(payload());
    expect(result.ok).toBe(true);
    expect(attempt).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Integration test — full round-trip: build event → dispatch → verify
// ---------------------------------------------------------------------------

describe("integration: makePaymentEvent → dispatch → verifySignature", () => {
  it("subscriber can verify the signature on a dispatched payload", async () => {
    const secret = "integration-secret";
    let capturedBody = "";
    let capturedSig = "";

    const fetcher: FetchLike = async (_url, init) => {
      capturedBody = init.body;
      capturedSig = init.headers[WEBHOOK_HEADERS.signature]!;
      return { ok: true, status: 200 };
    };

    const d = new PaymentWebhookDispatcher("https://example.test/hook", secret, { fetcher });
    const evt = makePaymentEvent("submitted", "pay_int_1", { currency: "XLM" });
    const result = await d.dispatch(evt);

    expect(result.ok).toBe(true);
    expect(verifySignature(secret, capturedBody, capturedSig)).toBe(true);
    const parsed = JSON.parse(capturedBody) as PaymentWebhookPayload;
    expect(parsed.event).toBe("payment.submitted");
    expect(parsed.paymentId).toBe("pay_int_1");
  });

  it("covers all four status transitions end-to-end", async () => {
    const secret = "int-secret-2";
    const statuses = ["pending", "submitted", "confirmed", "failed"] as const;

    for (const status of statuses) {
      let capturedBody = "";
      let capturedSig = "";
      const fetcher: FetchLike = async (_url, init) => {
        capturedBody = init.body;
        capturedSig = init.headers[WEBHOOK_HEADERS.signature]!;
        return { ok: true, status: 200 };
      };

      const d = new PaymentWebhookDispatcher("https://example.test/hook", secret, { fetcher });
      const evt = makePaymentEvent(status, `pay_${status}`);
      await d.dispatch(evt);

      expect(verifySignature(secret, capturedBody, capturedSig)).toBe(true);
      const parsed = JSON.parse(capturedBody) as PaymentWebhookPayload;
      expect(parsed.event).toBe(`payment.${status}`);
    }
  });
});
