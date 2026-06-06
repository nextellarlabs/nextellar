import {
  STELLAR_TRANSACTION_CONFIRMED_EVENT,
  StellarWebhookDispatcher,
  WEBHOOK_DISPATCHER_HEADERS,
  buildStellarTransactionPayload,
  createInMemoryWebhookSubscriptionStore,
  signWebhookPayload,
  verifyWebhookSignature,
  type FetchLike,
  type StellarConfirmedTransaction,
  type WebhookSubscription,
} from "../lib/webhookDispatcher.js";

const accountId = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function transaction(
  overrides: Partial<StellarConfirmedTransaction> = {},
): StellarConfirmedTransaction {
  return {
    hash: "9f0f4c9e8d2d5f6a4b3c2a1908172635445362718071625344a3b2c1d0e9f8a7",
    ledger: 55_123,
    createdAt: "2026-06-01T18:30:00Z",
    sourceAccount: accountId,
    successful: true,
    feeCharged: "100",
    pagingToken: "236746978123776",
    ...overrides,
  };
}

function subscription(
  overrides: Partial<WebhookSubscription> = {},
): WebhookSubscription {
  return {
    id: "sub_1",
    accountId,
    url: "https://downstream.example/webhooks/stellar",
    secret: "super-secret-value",
    createdAt: "2026-06-01T18:00:00.000Z",
    ...overrides,
  };
}

describe("Stellar transaction webhook signatures", () => {
  it("signs and verifies the timestamped JSON body", () => {
    const body = JSON.stringify(
      buildStellarTransactionPayload({ accountId, transaction: transaction() }),
    );
    const timestamp = "1780338600000";
    const signature = signWebhookPayload("secret", timestamp, body);

    expect(verifyWebhookSignature("secret", timestamp, body, signature)).toBe(true);
    expect(verifyWebhookSignature("secret", timestamp, `${body} `, signature)).toBe(false);
    expect(verifyWebhookSignature("wrong", timestamp, body, signature)).toBe(false);
    expect(verifyWebhookSignature("secret", timestamp, body, "not-hex")).toBe(false);
  });

  it("rejects non-successful transaction payloads", () => {
    expect(() =>
      buildStellarTransactionPayload({
        accountId,
        transaction: {
          ...transaction(),
          successful: false as unknown as true,
        },
      }),
    ).toThrow("only successful Stellar transactions");
  });
});

describe("StellarWebhookDispatcher", () => {
  it("dispatches a confirmed transaction with HMAC headers", async () => {
    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    const fetcher: FetchLike = async (url, init) => {
      seen.push({ url, headers: init.headers, body: init.body });
      return { ok: true, status: 204 };
    };
    const dispatcher = new StellarWebhookDispatcher(
      createInMemoryWebhookSubscriptionStore(),
      {
        fetcher,
        now: () => 1_780_338_600_000,
        nextDeliveryId: () => "delivery_1",
      },
    );

    const payload = buildStellarTransactionPayload({
      accountId,
      transaction: transaction(),
    });
    const result = await dispatcher.dispatchToSubscription(subscription(), payload);

    expect(result).toEqual({
      ok: true,
      subscriptionId: "sub_1",
      attempts: 1,
      lastStatus: 204,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://downstream.example/webhooks/stellar");
    expect(seen[0]!.headers[WEBHOOK_DISPATCHER_HEADERS.event]).toBe(
      STELLAR_TRANSACTION_CONFIRMED_EVENT,
    );
    expect(seen[0]!.headers[WEBHOOK_DISPATCHER_HEADERS.timestamp]).toBe(
      "1780338600000",
    );
    expect(seen[0]!.headers[WEBHOOK_DISPATCHER_HEADERS.delivery]).toBe(
      "delivery_1",
    );
    expect(
      verifyWebhookSignature(
        "super-secret-value",
        seen[0]!.headers[WEBHOOK_DISPATCHER_HEADERS.timestamp]!,
        seen[0]!.body,
        seen[0]!.headers[WEBHOOK_DISPATCHER_HEADERS.signature]!,
      ),
    ).toBe(true);
  });

  it("retries transient failures with exponential backoff", async () => {
    let calls = 0;
    const fetcher: FetchLike = async () => {
      calls += 1;
      return calls < 3 ? { ok: false, status: 503 } : { ok: true, status: 200 };
    };
    const delays: number[] = [];
    const sleep = async (ms: number) => {
      delays.push(ms);
    };
    const dispatcher = new StellarWebhookDispatcher(
      createInMemoryWebhookSubscriptionStore(),
      {
        fetcher,
        sleep,
        maxAttempts: 4,
        baseDelayMs: 25,
        maxDelayMs: 100,
      },
    );

    const result = await dispatcher.dispatchToSubscription(
      subscription(),
      buildStellarTransactionPayload({ accountId, transaction: transaction() }),
    );

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(delays).toEqual([25, 50]);
  });

  it("does not retry permanent 4xx responses except rate limits", async () => {
    let calls = 0;
    const fetcher: FetchLike = async () => {
      calls += 1;
      return { ok: false, status: 400 };
    };
    const dispatcher = new StellarWebhookDispatcher(
      createInMemoryWebhookSubscriptionStore(),
      {
        fetcher,
        sleep: async () => {},
        maxAttempts: 4,
      },
    );

    const result = await dispatcher.dispatchToSubscription(
      subscription(),
      buildStellarTransactionPayload({ accountId, transaction: transaction() }),
    );

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(1);
    expect(calls).toBe(1);
  });

  it("dispatches to subscribers watching the confirmed account", async () => {
    const store = createInMemoryWebhookSubscriptionStore();
    await store.save(subscription({ id: "sub_1", url: "https://a.example/hook" }));
    await store.save(subscription({ id: "sub_2", url: "https://b.example/hook" }));
    await store.save(
      subscription({
        id: "sub_other",
        accountId: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        url: "https://c.example/hook",
      }),
    );

    const urls: string[] = [];
    const dispatcher = new StellarWebhookDispatcher(store, {
      fetcher: async (url) => {
        urls.push(url);
        return { ok: true, status: 200 };
      },
    });

    const result = await dispatcher.dispatchConfirmedTransaction({
      accountId,
      transaction: transaction(),
    });

    expect(result.delivered).toBe(2);
    expect(result.failed).toBe(0);
    expect(urls.sort()).toEqual([
      "https://a.example/hook",
      "https://b.example/hook",
    ]);
  });
});
