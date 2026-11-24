/**
 * #1503: retry-with-jitter wrapper for idempotent Horizon GETs.
 * All timing is driven by Jest fake timers; jitter is injected via `random`.
 */
import { jest } from "@jest/globals";
import {
  horizonFetch,
  parseRetryAfterMs,
} from "../../src/templates/default/src/lib/horizonFetch";
import { HorizonRateLimiter } from "../../src/templates/default/src/lib/horizonRateLimiter";

const URL_ = "https://horizon.test/order_book";

const res = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 200 ? "{}" : "", { status, headers });

describe("horizonFetch (#1503)", () => {
  let limiter: HorizonRateLimiter;
  let fetchImpl: jest.Mock<typeof fetch>;

  const run = (
    init?: RequestInit,
    opts: Parameters<typeof horizonFetch>[2] = {},
  ) =>
    horizonFetch(URL_, init, {
      rateLimiter: limiter,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      random: () => 1, // no jitter reduction: delay == full backoff ceiling
      baseDelayMs: 100,
      ...opts,
    });

  beforeEach(() => {
    jest.useFakeTimers();
    limiter = new HorizonRateLimiter({ maxRequestsPerWindow: 100 });
    fetchImpl = jest.fn<typeof fetch>();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns immediately on success without retrying", async () => {
    fetchImpl.mockResolvedValue(res(200));
    const out = await run();
    expect(out.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries network errors with exponential backoff", async () => {
    fetchImpl
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(res(200));

    const p = run();
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(99); // first delay is 100ms
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(199); // second delay is 200ms
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    expect((await p).status).toBe(200);
  });

  it("applies jitter between 0 and the backoff ceiling", async () => {
    fetchImpl
      .mockRejectedValueOnce(new TypeError("x"))
      .mockResolvedValueOnce(res(200));

    const p = run(undefined, { random: () => 0.5 });
    await jest.advanceTimersByTimeAsync(49);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1); // 0.5 * 100ms
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await p;
  });

  it("caps the backoff at maxDelayMs", async () => {
    fetchImpl
      .mockRejectedValueOnce(new TypeError("x"))
      .mockRejectedValueOnce(new TypeError("x"))
      .mockResolvedValueOnce(res(200));

    const p = run(undefined, { baseDelayMs: 1000, maxDelayMs: 1500 });
    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1499); // would be 2000 uncapped
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await p;
  });

  it.each([502, 503, 504])("retries status %i", async (status) => {
    fetchImpl
      .mockResolvedValueOnce(res(status))
      .mockResolvedValueOnce(res(200));
    const p = run();
    await jest.advanceTimersByTimeAsync(100);
    expect((await p).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([400, 404, 500])("does not retry status %i", async (status) => {
    fetchImpl.mockResolvedValue(res(status));
    const out = await run();
    expect(out.status).toBe(status);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxRetries and returns the last response", async () => {
    fetchImpl.mockResolvedValue(res(503));
    const p = run(undefined, { maxRetries: 2 });
    await jest.advanceTimersByTimeAsync(1000);
    expect((await p).status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("throws the last network error after maxRetries", async () => {
    fetchImpl.mockRejectedValue(new TypeError("offline"));
    const p = run(undefined, { maxRetries: 1 });
    const assertion = expect(p).rejects.toThrow("offline");
    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never retries non-idempotent methods", async () => {
    fetchImpl.mockResolvedValue(res(503));
    const out = await run({ method: "POST" });
    expect(out.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  describe("Retry-After", () => {
    it("waits for Retry-After seconds when longer than the backoff", async () => {
      fetchImpl
        .mockResolvedValueOnce(res(503, { "Retry-After": "3" }))
        .mockResolvedValueOnce(res(200));
      const p = run();
      await jest.advanceTimersByTimeAsync(2999);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect((await p).status).toBe(200);
    });

    it("supports HTTP-date values", async () => {
      jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      fetchImpl
        .mockResolvedValueOnce(
          res(503, { "Retry-After": "Thu, 01 Jan 2026 00:00:05 GMT" }),
        )
        .mockResolvedValueOnce(res(200));
      const p = run();
      await jest.advanceTimersByTimeAsync(4999);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await p;
    });

    it("returns the response instead of waiting past maxRetryAfterMs", async () => {
      fetchImpl.mockResolvedValue(res(503, { "Retry-After": "120" }));
      const out = await run();
      expect(out.status).toBe(503);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("parseRetryAfterMs handles seconds, dates, and garbage", () => {
      const now = Date.parse("2026-01-01T00:00:00Z");
      expect(parseRetryAfterMs("7", now)).toBe(7000);
      expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:02 GMT", now)).toBe(
        2000,
      );
      expect(parseRetryAfterMs("Wed, 31 Dec 2025 00:00:00 GMT", now)).toBe(0);
      expect(parseRetryAfterMs("soon", now)).toBeUndefined();
      expect(parseRetryAfterMs(null, now)).toBeUndefined();
    });
  });

  describe("rate limiter integration", () => {
    it("feeds a 429 and its Retry-After into the limiter, then waits it out", async () => {
      fetchImpl
        .mockResolvedValueOnce(res(429, { "Retry-After": "2" }))
        .mockResolvedValueOnce(res(200));

      const p = run();
      await jest.advanceTimersByTimeAsync(0);
      expect(limiter.isRateLimited()).toBe(true);
      expect(limiter.getRemainingCooldownMs()).toBe(2000);

      await jest.advanceTimersByTimeAsync(1999);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect((await p).status).toBe(200);
    });

    it("uses the limiter's default cooldown when a 429 has no Retry-After", async () => {
      fetchImpl.mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(200));
      const p = run();
      await jest.advanceTimersByTimeAsync(4999); // default 5s cooldown
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await p;
    });

    it("does not send a request while the limiter is in cooldown", async () => {
      limiter.record429(3);
      fetchImpl.mockResolvedValue(res(200));
      const p = run();
      await jest.advanceTimersByTimeAsync(2999);
      expect(fetchImpl).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect((await p).status).toBe(200);
    });

    it("throws the guard error if the request budget stays exhausted", async () => {
      const tight = new HorizonRateLimiter({
        maxRequestsPerWindow: 1,
        windowMs: 60_000,
      });
      fetchImpl.mockResolvedValue(res(200));
      await run(undefined, { rateLimiter: tight }); // uses the only token

      fetchImpl.mockClear();
      const p = run(undefined, { rateLimiter: tight, maxRetries: 2 });
      const assertion = expect(p).rejects.toThrow(
        "Client rate-limit guard active",
      );
      await jest.advanceTimersByTimeAsync(1000); // < windowMs
      await assertion;
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe("abort handling", () => {
    it("cancels a pending backoff wait when aborted", async () => {
      fetchImpl.mockRejectedValue(new TypeError("offline"));
      const ctrl = new AbortController();
      const p = run({ signal: ctrl.signal });
      const assertion = expect(p).rejects.toBeDefined();
      await jest.advanceTimersByTimeAsync(0);
      ctrl.abort();
      await assertion;
      await jest.advanceTimersByTimeAsync(10_000);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("does not retry an aborted fetch", async () => {
      const ctrl = new AbortController();
      fetchImpl.mockImplementation(async () => {
        ctrl.abort();
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      });
      await expect(run({ signal: ctrl.signal })).rejects.toBeDefined();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("does not start if already aborted", async () => {
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(run({ signal: ctrl.signal })).rejects.toBeDefined();
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});
