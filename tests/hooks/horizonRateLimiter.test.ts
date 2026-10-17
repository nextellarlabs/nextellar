/**
 * @jest-environment jsdom
 *
 * Coverage for #1121's client-side rate-limit guard for Horizon calls.
 */
import { HorizonRateLimiter } from "../../src/templates/default/src/lib/horizonRateLimiter";

describe("HorizonRateLimiter (#1121)", () => {
  let limiter: HorizonRateLimiter;

  beforeEach(() => {
    limiter = new HorizonRateLimiter({
      maxRequestsPerWindow: 3,
      windowMs: 1000,
      defaultBackoffMs: 5000,
    });
  });

  it("allows requests under the limit", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    await expect(limiter.execute(fn)).resolves.toBe("ok");
    await expect(limiter.execute(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(limiter.isRateLimited()).toBe(false);
  });

  it("blocks requests exceeding maxRequestsPerWindow", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    await limiter.execute(fn);
    await limiter.execute(fn);
    await limiter.execute(fn);

    expect(limiter.isRateLimited()).toBe(true);
    await expect(limiter.execute(fn)).rejects.toThrow("Client rate-limit guard active");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("triggers backoff on 429 status response", async () => {
    const error429 = { status: 429 };
    const fn = jest.fn().mockRejectedValue(error429);

    await expect(limiter.execute(fn)).rejects.toEqual(error429);
    expect(limiter.isRateLimited()).toBe(true);
    expect(limiter.getRemainingCooldownMs()).toBeGreaterThan(0);
  });

  it("resets limit state properly", async () => {
    limiter.record429(10);
    expect(limiter.isRateLimited()).toBe(true);
    limiter.reset();
    expect(limiter.isRateLimited()).toBe(false);
  });
});
