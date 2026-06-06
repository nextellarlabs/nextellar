import { createHorizonClient, type HorizonFetcher, type HorizonFailoverEvent } from "../lib/horizonClient.js";

function makeFetcher(handlers: Record<string, () => Promise<{ ok: boolean; status: number; body: unknown }>>): HorizonFetcher {
  return async (url) => {
    const key = Object.keys(handlers).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected url ${url}`);
    const result = await handlers[key]!();
    return {
      ok: result.ok,
      status: result.status,
      json: async () => result.body,
    };
  };
}

describe("createHorizonClient", () => {
  const PRIMARY = "https://horizon.primary.test";
  const FALLBACK = "https://horizon.fallback.test";

  it("uses the primary endpoint when healthy", async () => {
    const fetcher = makeFetcher({
      [PRIMARY]: async () => ({ ok: true, status: 200, body: { ok: true, source: "primary" } }),
    });
    const client = createHorizonClient({
      primaryUrl: PRIMARY,
      fallbackUrl: FALLBACK,
      fetcher,
      timeoutMs: 100,
    });
    const body = await client.getJson<{ source: string }>("/accounts/GABC");
    expect(body.source).toBe("primary");
    expect(client.lastEndpointUsed()).toBe("primary");
  });

  it("fails over to the fallback endpoint and emits a structured log event", async () => {
    const events: HorizonFailoverEvent[] = [];
    const fetcher = makeFetcher({
      [PRIMARY]: async () => {
        throw new Error("ECONNREFUSED");
      },
      [FALLBACK]: async () => ({ ok: true, status: 200, body: { ok: true, source: "fallback" } }),
    });
    const client = createHorizonClient({
      primaryUrl: PRIMARY,
      fallbackUrl: FALLBACK,
      fetcher,
      timeoutMs: 100,
      onFailover: (event) => events.push(event),
    });
    const body = await client.getJson<{ source: string }>("/ledgers?limit=1");
    expect(body.source).toBe("fallback");
    expect(client.lastEndpointUsed()).toBe("fallback");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "horizon.failover",
      primaryUrl: PRIMARY,
      fallbackUrl: FALLBACK,
      reason: expect.stringMatching(/ECONNREFUSED/),
    });
  });

  it("throws when primary fails and no fallback is configured", async () => {
    const fetcher = makeFetcher({
      [PRIMARY]: async () => ({ ok: false, status: 503, body: {} }),
    });
    const client = createHorizonClient({
      primaryUrl: PRIMARY,
      fetcher,
      timeoutMs: 100,
    });
    await expect(client.getJson("/accounts/GABC")).rejects.toThrow(/HTTP 503/);
  });
});
