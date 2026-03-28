import {
  isValidUrl,
  validateHorizonUrl,
  validateSorobanUrl,
} from "../src/lib/validate";

describe("URL validation utilities", () => {
  describe("isValidUrl", () => {
    it("returns true for valid HTTPS URLs", () => {
      expect(isValidUrl("https://horizon-testnet.stellar.org")).toBe(true);
    });

    it("returns true for valid HTTP URLs", () => {
      expect(isValidUrl("http://localhost:8000")).toBe(true);
    });

    it("returns true for URLs with ports", () => {
      expect(isValidUrl("https://horizon.example.com:8443")).toBe(true);
    });

    it("returns true for URLs with trailing slashes", () => {
      expect(isValidUrl("https://horizon.stellar.org/")).toBe(true);
    });

    it("returns false when protocol is missing", () => {
      expect(isValidUrl("horizon-testnet.stellar.org")).toBe(false);
    });

    it("returns false for malformed URLs", () => {
      expect(isValidUrl("htps://horizon.stellar.org")).toBe(false);
    });

    it("returns false for non-http schemes", () => {
      expect(isValidUrl("ftp://horizon.stellar.org")).toBe(false);
    });

    it("returns false for empty strings", () => {
      expect(isValidUrl("")).toBe(false);
    });

    it("returns false for whitespace-only strings", () => {
      expect(isValidUrl("   ")).toBe(false);
    });
  });

  describe("validateHorizonUrl", () => {
    it("does not throw for a valid Horizon URL", () => {
      expect(() =>
        validateHorizonUrl("https://horizon-testnet.stellar.org"),
      ).not.toThrow();
    });

    it("throws a descriptive error for an invalid Horizon URL", () => {
      expect(() => validateHorizonUrl("invalid-url")).toThrow(
        'Invalid Horizon URL: "invalid-url"',
      );
    });
  });

  describe("validateSorobanUrl", () => {
    it("does not throw for a valid Soroban URL", () => {
      expect(() =>
        validateSorobanUrl("https://soroban-testnet.stellar.org"),
      ).not.toThrow();
    });

    it("throws a descriptive error for an invalid Soroban URL", () => {
      expect(() => validateSorobanUrl("invalid-url")).toThrow(
        'Invalid Soroban URL: "invalid-url"',
      );
    });
  });
});
