/**
 * Horizon proxy tests (#1461).
 *
 * Covers the pieces that matter for the security boundary: the path allowlist,
 * the client opt-in resolver, server-side key injection, short-lived GET
 * caching, and rate-limit header forwarding. No test talks to a real provider.
 */
import { jest } from "@jest/globals";

import {
  HORIZON_PROXY_PATH,
  isAllowedHorizonPath,
  isHorizonProxyEnabled,
  resolveHorizonUrl,
} from "../src/templates/default/src/lib/horizonProxy";

const ACCOUNT = "GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ";
const TX_HASH = "a".repeat(64);
const BALANCE_ID = "b".repeat(72);

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_PROXY_ENV = {
  NEXT_PUBLIC_HORIZON_PROXY: process.env.NEXT_PUBLIC_HORIZON_PROXY,
  HORIZON_PROXY_URL: process.env.HORIZON_PROXY_URL,
  HORIZON_PROXY_API_KEY: process.env.HORIZON_PROXY_API_KEY,
  HORIZON_PROXY_API_KEY_HEADER: process.env.HORIZON_PROXY_API_KEY_HEADER,
  HORIZON_PROXY_CACHE_TTL_MS: process.env.HORIZON_PROXY_CACHE_TTL_MS,
  HORIZON_PROXY_TIMEOUT_MS: process.env.HORIZON_PROXY_TIMEOUT_MS,
};

function resetProxyEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_PROXY_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

type RouteContext = { params: Promise<{ path?: string[] }> };
type GetRoute = (request: Request, context: RouteContext) => Promise<Response>;

function ctx(path: string[]): RouteContext {
  return { params: Promise.resolve({ path }) };
}

function request(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000/api/horizon/${pathname}`, init);
}

async function loadRouteHandler(): Promise<GetRoute> {
  jest.resetModules();
  const mod =
    await import("../src/templates/default/src/app/api/horizon/[...path]/route");
  return mod.GET as unknown as GetRoute;
}

let fetchMock: jest.Mock;

beforeEach(() => {
  resetProxyEnv();
  delete process.env.NEXT_PUBLIC_HORIZON_PROXY;
  delete process.env.HORIZON_PROXY_URL;
  delete process.env.HORIZON_PROXY_API_KEY;
  delete process.env.HORIZON_PROXY_API_KEY_HEADER;
  delete process.env.HORIZON_PROXY_CACHE_TTL_MS;
  delete process.env.HORIZON_PROXY_TIMEOUT_MS;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: jest.fn(),
  });
  fetchMock = globalThis.fetch as unknown as jest.Mock;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  resetProxyEnv();
  jest.restoreAllMocks();
});

describe("Horizon proxy allowlist", () => {
  const ALLOWED: Array<[string, string[]]> = [
    ["accounts/{id}", ["accounts", ACCOUNT]],
    ["accounts/{id}/balances", ["accounts", ACCOUNT, "balances"]],
    ["accounts/{id}/payments", ["accounts", ACCOUNT, "payments"]],
    ["accounts/{id}/transactions", ["accounts", ACCOUNT, "transactions"]],
    ["ledgers", ["ledgers"]],
    ["ledgers/{sequence}", ["ledgers", "123456"]],
    ["ledgers/{sequence}/operations", ["ledgers", "123456", "operations"]],
    ["transactions/{hash}", ["transactions", TX_HASH]],
    ["operations/{id}", ["operations", "987"]],
    ["payments", ["payments"]],
    ["effects", ["effects"]],
    ["fee_stats", ["fee_stats"]],
    ["network", ["network"]],
    ["assets", ["assets"]],
    ["order_book", ["order_book"]],
    ["trade_aggregations", ["trade_aggregations"]],
    ["claimable_balances/{id}", ["claimable_balances", BALANCE_ID]],
    ["liquidity_pools", ["liquidity_pools"]],
    ["paths/strict-send", ["paths", "strict-send"]],
    ["paths/strict-receive", ["paths", "strict-receive"]],
  ];

  const REJECTED: Array<[string, string[]]> = [
    ["empty path", []],
    ["admin", ["admin"]],
    ["bare accounts", ["accounts"]],
    ["invalid account id", ["accounts", "not-an-account"]],
    ["unknown account sub-resource", ["accounts", ACCOUNT, "secret"]],
    [
      "too many account sub-segments",
      ["accounts", ACCOUNT, "signers", "extra"],
    ],
    ["encoded traversal", ["accounts", "..", "ledgers"]],
    ["trailing traversal", ["accounts", ACCOUNT, ".."]],
    ["non-numeric ledger", ["ledgers", "not-a-number"]],
    ["malformed transaction hash", ["transactions", "not-a-hash"]],
    ["non-numeric operation", ["operations", "abc"]],
    ["unknown paths endpoint", ["paths", "anything"]],
    ["short claimable balance id", ["claimable_balances", "short"]],
    ["short liquidity pool id", ["liquidity_pools", "short"]],
    ["extra fee_stats segment", ["fee_stats", "extra"]],
    [
      "unknown nested account endpoint",
      ["accounts", ACCOUNT, "balances", "and", "more"],
    ],
  ];

  it.each(ALLOWED)("allows /%s", (_label, segments) => {
    expect(isAllowedHorizonPath(segments)).toBe(true);
  });

  it.each(REJECTED)("rejects %s", (_label, segments) => {
    expect(isAllowedHorizonPath(segments)).toBe(false);
  });
});

describe("Horizon proxy client opt-in", () => {
  it("is disabled unless NEXT_PUBLIC_HORIZON_PROXY is truthy", () => {
    expect(isHorizonProxyEnabled()).toBe(false);

    for (const value of ["0", "false", "", "off"]) {
      process.env.NEXT_PUBLIC_HORIZON_PROXY = value;
      expect(isHorizonProxyEnabled()).toBe(false);
    }

    for (const value of ["1", "true", "TRUE", "yes", "on"]) {
      process.env.NEXT_PUBLIC_HORIZON_PROXY = value;
      expect(isHorizonProxyEnabled()).toBe(true);
    }
  });

  it("leaves direct Horizon URLs untouched when disabled", () => {
    expect(resolveHorizonUrl("https://horizon.stellar.org")).toBe(
      "https://horizon.stellar.org",
    );
  });

  it("returns the proxy path when enabled", () => {
    process.env.NEXT_PUBLIC_HORIZON_PROXY = "true";
    expect(resolveHorizonUrl("https://horizon.stellar.org")).toBe(
      HORIZON_PROXY_PATH,
    );
  });

  it("returns an absolute proxy URL in the browser", () => {
    process.env.NEXT_PUBLIC_HORIZON_PROXY = "true";
    const originalWindow = (globalThis as { window?: unknown }).window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: { location: { origin: "https://app.example" } },
    });

    try {
      expect(resolveHorizonUrl("https://horizon.stellar.org")).toBe(
        `https://app.example${HORIZON_PROXY_PATH}`,
      );
    } finally {
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
    }
  });
});

describe("GET /api/horizon/[...path]", () => {
  it("rejects a path outside the allowlist without calling the provider", async () => {
    const GET = await loadRouteHandler();

    const res = await GET(request("admin"), ctx(["admin"]));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Path is not allowed by the Horizon proxy allowlist",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown suffix under an allowlisted account path", async () => {
    const GET = await loadRouteHandler();

    const res = await GET(
      request(`accounts/${ACCOUNT}/secret`),
      ctx(["accounts", ACCOUNT, "secret"]),
    );

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("injects the server-side key, forwards the query, and drops client headers", async () => {
    process.env.HORIZON_PROXY_URL = "https://horizon.provider.test";
    process.env.HORIZON_PROXY_API_KEY = "server-secret";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ account_id: ACCOUNT }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-remaining": "42",
          "retry-after": "7",
        },
      }),
    );

    const GET = await loadRouteHandler();
    const res = await GET(
      request(`accounts/${ACCOUNT}?limit=5`, {
        headers: {
          authorization: "Bearer client-secret",
          cookie: "session=should-not-be-forwarded",
        },
      }),
      ctx(["accounts", ACCOUNT]),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ account_id: ACCOUNT });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(
      `https://horizon.provider.test/accounts/${ACCOUNT}?limit=5`,
    );

    const sentHeaders = new Headers(init.headers as HeadersInit);
    expect(sentHeaders.get("authorization")).toBe("Bearer server-secret");
    expect(sentHeaders.get("cookie")).toBeNull();
  });

  it("honors a custom provider key header", async () => {
    process.env.HORIZON_PROXY_URL = "https://horizon.provider.test";
    process.env.HORIZON_PROXY_API_KEY = "server-secret";
    process.env.HORIZON_PROXY_API_KEY_HEADER = "x-api-key";
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    const GET = await loadRouteHandler();
    await GET(request("fee_stats"), ctx(["fee_stats"]));

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const sentHeaders = new Headers(init.headers as HeadersInit);
    expect(sentHeaders.get("x-api-key")).toBe("server-secret");
    expect(sentHeaders.get("authorization")).toBeNull();
  });

  it("caches successful GETs briefly and marks cache hits", async () => {
    process.env.HORIZON_PROXY_URL = "https://horizon.provider.test";
    process.env.HORIZON_PROXY_CACHE_TTL_MS = "5000";
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const GET = await loadRouteHandler();
    const first = await GET(request("fee_stats"), ctx(["fee_stats"]));
    const second = await GET(request("fee_stats"), ctx(["fee_stats"]));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.headers.get("x-nextellar-proxy-cache")).toBe("MISS");
    expect(second.headers.get("x-nextellar-proxy-cache")).toBe("HIT");
    await expect(second.json()).resolves.toEqual({ ok: true });
  });

  it("does not cache error responses", async () => {
    process.env.HORIZON_PROXY_URL = "https://horizon.provider.test";
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ status: 429 }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "3",
          },
        }),
    );

    const GET = await loadRouteHandler();
    const first = await GET(request("fee_stats"), ctx(["fee_stats"]));
    const second = await GET(request("fee_stats"), ctx(["fee_stats"]));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("3");
    expect(second.headers.get("x-nextellar-proxy-cache")).toBe("MISS");
  });

  it("returns 502 when the upstream request fails", async () => {
    process.env.HORIZON_PROXY_URL = "https://horizon.provider.test";
    fetchMock.mockRejectedValue(new Error("connection refused"));

    const GET = await loadRouteHandler();
    const res = await GET(request("fee_stats"), ctx(["fee_stats"]));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Horizon proxy request failed: connection refused",
    });
  });

  it("returns 500 when HORIZON_PROXY_URL is invalid", async () => {
    process.env.HORIZON_PROXY_URL = "not-a-url";

    const GET = await loadRouteHandler();
    const res = await GET(request("fee_stats"), ctx(["fee_stats"]));

    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/horizon/[...path]", () => {
  it("is rejected because the proxy is read-only", async () => {
    jest.resetModules();
    const { POST } =
      await import("../src/templates/default/src/app/api/horizon/[...path]/route");

    const res = POST();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });
});
