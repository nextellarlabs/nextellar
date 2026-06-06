import { validatePaymentAmount, precisionForAsset } from "../lib/amount.js";

describe("validatePaymentAmount", () => {
  it("accepts native XLM within 7 decimal places", () => {
    const result = validatePaymentAmount({
      amount: "10.0000001",
      asset: { code: "XLM" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.amount).toBe("10.0000001");
  });

  it("rejects zero amounts", () => {
    const result = validatePaymentAmount({
      amount: "0",
      asset: { code: "XLM" },
    });
    expect(result).toEqual({
      ok: false,
      errors: [{ field: "amount", message: "amount must be greater than zero" }],
    });
  });

  it("rejects negative numeric amounts", () => {
    const result = validatePaymentAmount({
      amount: -5,
      asset: { code: "XLM" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.field).toBe("amount");
    }
  });

  it("rejects over-precision for native assets", () => {
    const result = validatePaymentAmount({
      amount: "1.12345678",
      asset: { code: "XLM" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.message).toMatch(/7 decimal places/);
    }
  });

  it("rejects non-native assets without issuer", () => {
    const result = validatePaymentAmount({
      amount: "5",
      asset: { code: "USDC" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.field).toBe("asset");
    }
  });

  it("applies per-asset precision for EURT", () => {
    expect(precisionForAsset("EURT")).toBe(4);
    const ok = validatePaymentAmount({
      amount: "12.3456",
      asset: { code: "EURT", issuer: "GISSUER" },
    });
    expect(ok.ok).toBe(true);
    const bad = validatePaymentAmount({
      amount: "12.34567",
      asset: { code: "EURT", issuer: "GISSUER" },
    });
    expect(bad.ok).toBe(false);
  });
});
