/**
 * Health probes + backoff math for the NetworkStatus indicator (#1502).
 * `fetch` is mocked; no real network call is made.
 */
import { jest } from "@jest/globals";

const { checkHorizonHealth, checkRpcHealth, computeBackoffDelay } =
  await import("../../src/templates/default/src/lib/networkHealth");

const HORIZON = "https://horizon.test";
const RPC = "https://rpc.test";

function jsonResponse(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

describe("health probes (#1502)", () => {
  let fetchMock: jest.Mock<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn<typeof fetch>();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("checkHorizonHealth", () => {
    it("is healthy on a 2xx from the root endpoint", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ horizon_version: "x" }));
      await expect(checkHorizonHealth(HORIZON)).resolves.toBe(true);
      expect(fetchMock.mock.calls[0][0]).toBe(`${HORIZON}/`);
    });

    it("does not double the slash when the URL has a trailing slash", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      await checkHorizonHealth(`${HORIZON}/`);
      expect(fetchMock.mock.calls[0][0]).toBe(`${HORIZON}/`);
    });

    it("is unhealthy on a non-2xx response", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 503 }));
      await expect(checkHorizonHealth(HORIZON)).resolves.toBe(false);
    });

    it("is unhealthy (and never throws) when fetch rejects", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      await expect(checkHorizonHealth(HORIZON)).resolves.toBe(false);
    });

    it("is unhealthy when the probe times out", async () => {
      jest.useFakeTimers();
      // A fetch that only settles when it is aborted.
      fetchMock.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const result = checkHorizonHealth(HORIZON, { timeoutMs: 1000 });
      await jest.advanceTimersByTimeAsync(1000);
      await expect(result).resolves.toBe(false);
    });

    it("is unhealthy when the caller aborts the probe", async () => {
      fetchMock.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const controller = new AbortController();
      const result = checkHorizonHealth(HORIZON, { signal: controller.signal });
      controller.abort();
      await expect(result).resolves.toBe(false);
    });
  });

  describe("checkRpcHealth", () => {
    it("POSTs a getHealth JSON-RPC request and is healthy on status=healthy", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ jsonrpc: "2.0", id: 1, result: { status: "healthy" } }),
      );
      await expect(checkRpcHealth(RPC)).resolves.toBe(true);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(RPC);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toMatchObject({
        jsonrpc: "2.0",
        method: "getHealth",
      });
    });

    it("is unhealthy when the node reports any other status", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ result: { status: "unhealthy" } }),
      );
      await expect(checkRpcHealth(RPC)).resolves.toBe(false);
    });

    it("is unhealthy on a JSON-RPC error body", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: { code: -32603, message: "boom" } }),
      );
      await expect(checkRpcHealth(RPC)).resolves.toBe(false);
    });

    it("is unhealthy on a non-2xx response", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, { ok: false, status: 502 }));
      await expect(checkRpcHealth(RPC)).resolves.toBe(false);
    });

    it("is unhealthy when the body is not JSON", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      } as unknown as Response);
      await expect(checkRpcHealth(RPC)).resolves.toBe(false);
    });

    it("is unhealthy (and never throws) when fetch rejects", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      await expect(checkRpcHealth(RPC)).resolves.toBe(false);
    });
  });
});

describe("computeBackoffDelay (#1502)", () => {
  const opts = { baseMs: 1000, maxMs: 8000 };
  const noJitter = () => 0.5; // spread = 0

  it("doubles per consecutive failure", () => {
    expect(computeBackoffDelay(1, opts, noJitter)).toBe(1000);
    expect(computeBackoffDelay(2, opts, noJitter)).toBe(2000);
    expect(computeBackoffDelay(3, opts, noJitter)).toBe(4000);
  });

  it("is capped at maxMs", () => {
    expect(computeBackoffDelay(4, opts, noJitter)).toBe(8000);
    expect(computeBackoffDelay(20, opts, noJitter)).toBe(8000);
  });

  it("applies ±jitter around the exponential value", () => {
    expect(computeBackoffDelay(2, opts, () => 0)).toBe(1600); // 2000 - 20%
    expect(computeBackoffDelay(2, opts, () => 1)).toBe(2400); // 2000 + 20%
  });

  it("never exceeds maxMs even with upward jitter at the cap", () => {
    expect(computeBackoffDelay(10, opts, () => 1)).toBe(8000);
  });
});
