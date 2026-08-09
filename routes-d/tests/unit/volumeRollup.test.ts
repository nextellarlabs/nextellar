import {
  recordTrade,
  getTopAssets,
  __resetTrades,
  __seedTrade,
  __clearCache,
  __getCacheSize,
  type Trade,
} from "../../lib/volumeRollup.js";

const NOW = Date.now();
const HOUR_MS = 3_600_000;

function trade(
  overrides: Partial<Trade> & { asset: string },
): Trade {
  return {
    id: overrides.id ?? `trade-${Math.random().toString(36).slice(2)}`,
    amount: overrides.amount ?? 100,
    price: overrides.price ?? 1,
    timestamp: overrides.timestamp ?? new Date(NOW),
    ...overrides,
  };
}

describe("volumeRollup", () => {
  beforeEach(() => {
    __resetTrades();
  });

  describe("getTopAssets", () => {
    it("returns empty assets for empty trades", () => {
      const result = getTopAssets("24h");
      expect(result.window).toBe("24h");
      expect(result.assets).toEqual([]);
      expect(result.generatedAt).toBeInstanceOf(Date);
    });

    it("returns assets ranked by volume descending", () => {
      __seedTrade(trade({ asset: "XLM", amount: 100, price: 2 }));
      __seedTrade(trade({ asset: "USDC", amount: 50, price: 1 }));
      __seedTrade(trade({ asset: "XLM", amount: 50, price: 2 }));

      const result = getTopAssets("24h");

      expect(result.assets).toHaveLength(2);
      expect(result.assets[0].asset).toBe("XLM");
      expect(result.assets[0].volume).toBe(300);
      expect(result.assets[0].tradeCount).toBe(2);
      expect(result.assets[1].asset).toBe("USDC");
      expect(result.assets[1].volume).toBe(50);
      expect(result.assets[1].tradeCount).toBe(1);
    });

    it("filters trades outside the 24h window", () => {
      __seedTrade(
        trade({
          asset: "XLM",
          amount: 100,
          price: 1,
          timestamp: new Date(NOW - 48 * HOUR_MS),
        }),
      );
      __seedTrade(
        trade({
          asset: "XLM",
          amount: 100,
          price: 1,
          timestamp: new Date(NOW - 2 * HOUR_MS),
        }),
      );

      const result = getTopAssets("24h");
      expect(result.assets).toHaveLength(1);
      expect(result.assets[0].volume).toBe(100);
    });

    it("filters trades outside the 7d window", () => {
      __seedTrade(
        trade({
          asset: "USDC",
          amount: 50,
          price: 1,
          timestamp: new Date(NOW - 10 * 24 * HOUR_MS),
        }),
      );
      __seedTrade(
        trade({
          asset: "USDC",
          amount: 50,
          price: 1,
          timestamp: new Date(NOW - 3 * 24 * HOUR_MS),
        }),
      );

      const result7d = getTopAssets("7d");
      expect(result7d.assets).toHaveLength(1);
      expect(result7d.assets[0].volume).toBe(50);

      const result30d = getTopAssets("30d");
      expect(result30d.assets).toHaveLength(1);
      expect(result30d.assets[0].volume).toBe(100);
    });

    it("filters trades outside the 30d window", () => {
      __seedTrade(
        trade({
          asset: "BTC",
          amount: 1,
          price: 50000,
          timestamp: new Date(NOW - 60 * 24 * HOUR_MS),
        }),
      );
      __seedTrade(
        trade({
          asset: "BTC",
          amount: 1,
          price: 51000,
          timestamp: new Date(NOW - 15 * 24 * HOUR_MS),
        }),
      );

      const result = getTopAssets("30d");
      expect(result.assets).toHaveLength(1);
      expect(result.assets[0].volume).toBe(51000);
    });

    it("sets lastPrice to the most recent trade price per asset", () => {
      __seedTrade(
        trade({
          asset: "XLM",
          amount: 10,
          price: 1,
          timestamp: new Date(NOW - 10 * HOUR_MS),
        }),
      );
      __seedTrade(
        trade({
          asset: "XLM",
          amount: 10,
          price: 2,
          timestamp: new Date(NOW - 5 * HOUR_MS),
        }),
      );
      __seedTrade(
        trade({
          asset: "XLM",
          amount: 10,
          price: 3,
          timestamp: new Date(NOW - HOUR_MS),
        }),
      );

      const result = getTopAssets("24h");
      expect(result.assets[0].lastPrice).toBe(3);
    });

    it("handles multiple assets with varying trade counts", () => {
      for (let i = 0; i < 5; i++) {
        __seedTrade(trade({ asset: "XLM", amount: 10, price: 1 }));
      }
      for (let i = 0; i < 3; i++) {
        __seedTrade(trade({ asset: "USDC", amount: 20, price: 1 }));
      }
      __seedTrade(trade({ asset: "ETH", amount: 1, price: 3000 }));

      const result = getTopAssets("24h");
      expect(result.assets).toHaveLength(3);
      expect(result.assets[0].asset).toBe("ETH");
      expect(result.assets[1].asset).toBe("USDC");
      expect(result.assets[2].asset).toBe("XLM");
    });
  });

  describe("cache behavior", () => {
    it("returns cached result within TTL", () => {
      __seedTrade(trade({ asset: "XLM", amount: 100, price: 1 }));
      const first = getTopAssets("24h");
      expect(__getCacheSize()).toBe(1);

      __seedTrade(trade({ asset: "XLM", amount: 200, price: 1 }));
      const second = getTopAssets("24h");

      expect(second.assets[0].volume).toBe(first.assets[0].volume);
      expect(second.generatedAt.getTime()).toBe(first.generatedAt.getTime());
    });

    it("recomputes after cache is cleared", () => {
      __seedTrade(trade({ asset: "XLM", amount: 100, price: 1 }));
      const first = getTopAssets("24h");

      __clearCache();
      __seedTrade(trade({ asset: "XLM", amount: 200, price: 1 }));
      const second = getTopAssets("24h");

      expect(second.assets[0].volume).toBe(300);
    });

    it("recordTrade clears all caches", () => {
      getTopAssets("24h");
      getTopAssets("7d");
      getTopAssets("30d");
      expect(__getCacheSize()).toBe(3);

      recordTrade(trade({ asset: "XLM", amount: 1, price: 1 }));

      expect(__getCacheSize()).toBe(0);
    });

    it("caches each window independently", () => {
      __seedTrade(trade({ asset: "XLM", amount: 100, price: 1 }));
      const a = getTopAssets("24h");
      const b = getTopAssets("7d");
      const c = getTopAssets("30d");

      expect(__getCacheSize()).toBe(3);
      expect(a.assets[0].volume).toBe(100);
      expect(b.assets[0].volume).toBe(100);
      expect(c.assets[0].volume).toBe(100);
    });

    it("__resetTrades clears caches", () => {
      getTopAssets("24h");
      expect(__getCacheSize()).toBe(1);

      __resetTrades();
      expect(__getCacheSize()).toBe(0);
    });
  });
});
