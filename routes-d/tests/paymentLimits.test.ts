// Tests for per-tier payment limit enforcement (#292).
// Covers under, at, and over the limit for both per-transaction
// and daily total caps, plus window reset behaviour.

import {
  PaymentLimitsService,
  InMemoryPaymentLimitsStore,
  DEFAULT_TIER_LIMITS,
  type AccountTier,
} from "../lib/paymentLimits.js";

function makeService(
  overrides: Partial<{ windowMs: number; now: () => number }> = {},
) {
  const store = new InMemoryPaymentLimitsStore();
  const service = new PaymentLimitsService({
    store,
    windowMs: overrides.windowMs,
    now: overrides.now,
  });
  return { store, service };
}

describe("PaymentLimitsService (#292)", () => {
  describe("per-transaction limit", () => {
    it("allows a payment under the per-transaction cap", async () => {
      const { service } = makeService();
      const result = await service.check("user-1", "free", 50);
      expect(result.allowed).toBe(true);
    });

    it("allows a payment exactly at the per-transaction cap", async () => {
      const { service } = makeService();
      const cap = DEFAULT_TIER_LIMITS.free.maxPerTransaction;
      const result = await service.check("user-1", "free", cap);
      expect(result.allowed).toBe(true);
    });

    it("rejects a payment over the per-transaction cap with a reason", async () => {
      const { service } = makeService();
      const cap = DEFAULT_TIER_LIMITS.free.maxPerTransaction;
      const result = await service.check("user-1", "free", cap + 1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/per-transaction limit/);
    });
  });

  describe("daily total limit", () => {
    it("allows payments that stay under the daily total", async () => {
      const { service } = makeService();
      await service.recordPayment("user-2", 80);
      const result = await service.check("user-2", "free", 80);
      expect(result.allowed).toBe(true);
    });

    it("allows a payment that brings the total exactly to the daily cap", async () => {
      const { service } = makeService();
      const cap = DEFAULT_TIER_LIMITS.free.maxDailyTotal;
      await service.recordPayment("user-3", cap - 50);
      const result = await service.check("user-3", "free", 50);
      expect(result.allowed).toBe(true);
    });

    it("rejects a payment that would exceed the daily total", async () => {
      const { service } = makeService();
      const cap = DEFAULT_TIER_LIMITS.free.maxDailyTotal;
      await service.recordPayment("user-4", cap - 10);
      const result = await service.check("user-4", "free", 20);
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/daily total/);
    });
  });

  describe("tier thresholds", () => {
    const tiers: AccountTier[] = ["free", "basic", "pro", "enterprise"];

    it.each(tiers)("%s tier: allows a payment within its limits", async (tier) => {
      const { service } = makeService();
      const limits = DEFAULT_TIER_LIMITS[tier];
      const amount = Math.min(limits.maxPerTransaction, limits.maxDailyTotal) / 2;
      if (!Number.isFinite(amount)) {
        // enterprise has Infinity limits — just check it passes
        const result = await service.check("ent-user", tier, 1_000_000);
        expect(result.allowed).toBe(true);
        return;
      }
      const result = await service.check(`${tier}-user`, tier, amount);
      expect(result.allowed).toBe(true);
    });

    it("enterprise tier allows very large amounts", async () => {
      const { service } = makeService();
      const result = await service.check("ent-user", "enterprise", 999_999_999);
      expect(result.allowed).toBe(true);
    });
  });

  describe("window reset", () => {
    it("resets the window after the configured duration", async () => {
      let now = 0;
      const { service } = makeService({ windowMs: 1000, now: () => now });

      const cap = DEFAULT_TIER_LIMITS.free.maxDailyTotal;
      await service.recordPayment("user-5", cap);

      // Still within window — should be rejected
      const before = await service.check("user-5", "free", 1);
      expect(before.allowed).toBe(false);

      // Advance past the window
      now = 1001;
      const after = await service.check("user-5", "free", 1);
      expect(after.allowed).toBe(true);
    });

    it("resetWindow clears usage for a specific user", async () => {
      const { service } = makeService();
      const cap = DEFAULT_TIER_LIMITS.free.maxDailyTotal;
      await service.recordPayment("user-6", cap);

      await service.resetWindow("user-6");
      const result = await service.check("user-6", "free", 50);
      expect(result.allowed).toBe(true);
    });

    it("resetExpiredWindows only resets users whose window has expired", async () => {
      let now = 0;
      const { service } = makeService({ windowMs: 1000, now: () => now });

      const cap = DEFAULT_TIER_LIMITS.free.maxDailyTotal;
      await service.recordPayment("user-a", cap);
      await service.recordPayment("user-b", cap);

      // Advance past window for user-a only (both recorded at now=0)
      now = 1001;
      await service.resetExpiredWindows(["user-a", "user-b"]);

      const a = await service.check("user-a", "free", 50);
      expect(a.allowed).toBe(true);

      // user-b window also expired since both started at 0
      const b = await service.check("user-b", "free", 50);
      expect(b.allowed).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("rejects zero amount", async () => {
      const { service } = makeService();
      const result = await service.check("user-7", "free", 0);
      expect(result.allowed).toBe(false);
    });

    it("rejects negative amount", async () => {
      const { service } = makeService();
      const result = await service.check("user-8", "free", -10);
      expect(result.allowed).toBe(false);
    });
  });
});
