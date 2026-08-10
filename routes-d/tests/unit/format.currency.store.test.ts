import {
  formatCurrency,
  isValidCurrencyCode,
} from "../../lib/currencyFormatter.js";

describe("currencyFormatter Unit Tests", () => {
  describe("isValidCurrencyCode", () => {
    it("recognizes standard ISO-4217 currencies", () => {
      expect(isValidCurrencyCode("USD")).toBe(true);
      expect(isValidCurrencyCode("EUR")).toBe(true);
      expect(isValidCurrencyCode("GBP")).toBe(true);
      expect(isValidCurrencyCode("JPY")).toBe(true);
      expect(isValidCurrencyCode("BRL")).toBe(true);
    });

    it("recognizes Stellar native and crypto tokens", () => {
      expect(isValidCurrencyCode("XLM")).toBe(true);
      expect(isValidCurrencyCode("native")).toBe(true);
      expect(isValidCurrencyCode("NATIVE")).toBe(true);
      expect(isValidCurrencyCode("USDC")).toBe(true);
    });

    it("rejects unknown or invalid currency codes", () => {
      expect(isValidCurrencyCode("INVALID_XYZ")).toBe(false);
      expect(isValidCurrencyCode("FOOBAR123")).toBe(false);
      expect(isValidCurrencyCode("")).toBe(false);
    });
  });

  describe("formatCurrency well-known pairs", () => {
    it("formats USD in en-US locale", () => {
      const res = formatCurrency(1234.56, "USD", "en-US");
      expect(res.formatted).toContain("$1,234.56");
      expect(res.currency).toBe("USD");
      expect(res.amount).toBe(1234.56);
    });

    it("formats EUR in de-DE locale", () => {
      const res = formatCurrency(1234.56, "EUR", "de-DE");
      expect(res.formatted).toContain("1.234,56");
      expect(res.formatted).toContain("€");
    });

    it("formats JPY with 0 decimal places", () => {
      const res = formatCurrency(1500, "JPY", "ja-JP");
      expect(res.formatted).toContain("1,500");
      expect(res.formatted).toMatch(/[¥￥]/);
    });

    it("formats GBP in en-GB locale", () => {
      const res = formatCurrency(99.99, "GBP", "en-GB");
      expect(res.formatted).toContain("£99.99");
    });
  });

  describe("Stellar Native (XLM) & Crypto formatting", () => {
    it("formats XLM with default 7-decimal stroop precision", () => {
      const res = formatCurrency(12.3456789, "XLM", "en-US");
      expect(res.formatted).toBe("12.3456789 XLM");
      expect(res.isNative).toBe(true);
    });

    it("formats 'native' as XLM", () => {
      const res = formatCurrency(100, "native", "en-US");
      expect(res.formatted).toBe("100 XLM");
      expect(res.currency).toBe("XLM");
      expect(res.isNative).toBe(true);
    });

    it("handles 1 stroop edge precision (0.0000001)", () => {
      const res = formatCurrency(0.0000001, "XLM", "en-US");
      expect(res.formatted).toBe("0.0000001 XLM");
    });
  });

  describe("Edge cases & Error handling", () => {
    it("handles zero amount", () => {
      const res = formatCurrency(0, "USD", "en-US");
      expect(res.formatted).toBe("$0.00");
    });

    it("handles negative amounts", () => {
      const res = formatCurrency(-50.25, "USD", "en-US");
      expect(res.formatted).toBe("-$50.25");
    });

    it("handles string amount input", () => {
      const res = formatCurrency("999.99", "USD", "en-US");
      expect(res.formatted).toBe("$999.99");
    });

    it("throws error for non-numeric amounts", () => {
      expect(() => formatCurrency("not-a-number", "USD")).toThrow("Invalid numeric amount");
    });

    it("throws error for unknown currency code", () => {
      expect(() => formatCurrency(100, "UNKNOWN_CODE")).toThrow("Unsupported or unknown currency code");
    });
  });
});
