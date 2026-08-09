import {
  negotiateLocale,
  parseAcceptLanguageHeader,
  DEFAULT_SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
} from "../../middleware/locale.js";

describe("Unit: locale middleware helpers", () => {
  describe("parseAcceptLanguageHeader", () => {
    it("returns empty array for missing or invalid header types", () => {
      expect(parseAcceptLanguageHeader(undefined)).toEqual([]);
      expect(parseAcceptLanguageHeader("")).toEqual([]);
    });

    it("parses single language tag with default q=1", () => {
      const parsed = parseAcceptLanguageHeader("fr");
      expect(parsed).toEqual([{ code: "fr", base: "fr", quality: 1.0 }]);
    });

    it("parses multiple language tags with quality weights and sorts descending", () => {
      const parsed = parseAcceptLanguageHeader("fr;q=0.5, es-MX;q=0.9, en;q=0.8");
      expect(parsed).toEqual([
        { code: "es-mx", base: "es", quality: 0.9 },
        { code: "en", base: "en", quality: 0.8 },
        { code: "fr", base: "fr", quality: 0.5 },
      ]);
    });

    it("ignores malformed segments without throwing", () => {
      const parsed = parseAcceptLanguageHeader(";;;, fr;q=invalid, es;q=0.8, ,,");
      expect(parsed.length).toBeGreaterThan(0);
      expect(parsed.some((p) => p.code === "es")).toBe(true);
    });
  });

  describe("negotiateLocale", () => {
    it("matches exact supported language", () => {
      expect(negotiateLocale("fr")).toBe("fr");
      expect(negotiateLocale("es")).toBe("es");
      expect(negotiateLocale("de")).toBe("de");
    });

    it("matches base language for regional subtags", () => {
      expect(negotiateLocale("es-MX")).toBe("es");
      expect(negotiateLocale("fr-CA")).toBe("fr");
      expect(negotiateLocale("pt-BR")).toBe("pt");
    });

    it("selects highest weighted quality factor", () => {
      expect(negotiateLocale("fr;q=0.3, es;q=0.9, de;q=0.6")).toBe("es");
    });

    it("handles wildcard * tag", () => {
      expect(negotiateLocale("*")).toBe(DEFAULT_SUPPORTED_LOCALES[0]);
    });

    it("falls back to default locale for unsupported languages", () => {
      expect(negotiateLocale("zh-CN, ja-JP")).toBe(DEFAULT_LOCALE);
      expect(negotiateLocale("ko")).toBe(DEFAULT_LOCALE);
    });

    it("falls back to default locale for missing or empty header", () => {
      expect(negotiateLocale(undefined)).toBe(DEFAULT_LOCALE);
      expect(negotiateLocale("")).toBe(DEFAULT_LOCALE);
    });

    it("handles malformed headers gracefully by falling back", () => {
      expect(negotiateLocale(";;;q=bad, $$$")).toBe(DEFAULT_LOCALE);
    });

    it("supports custom supported locales and default locale", () => {
      const customSupported = ["ja", "ko", "zh"];
      const customDefault = "ja";

      expect(negotiateLocale("ko-KR", customSupported, customDefault)).toBe("ko");
      expect(negotiateLocale("it", customSupported, customDefault)).toBe("ja");
    });
  });
});
