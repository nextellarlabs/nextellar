import {
  buildSep7PayUri,
  parseSep7PayUri,
  isSep7Uri,
} from "../../src/templates/default/src/lib/sep7";

const DESTINATION = "GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ";
const ISSUER = "GISSUERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWJ4";

describe("buildSep7PayUri", () => {
  it("builds a minimal URI with just a destination (native XLM, no amount)", () => {
    const uri = buildSep7PayUri({ destination: DESTINATION });

    expect(uri).toBe(`web+stellar:pay?destination=${DESTINATION}`);
  });

  it("includes amount when provided", () => {
    const uri = buildSep7PayUri({ destination: DESTINATION, amount: "10.5" });

    expect(uri).toContain("web+stellar:pay?");
    const parsed = new URL(uri.replace("web+stellar:", "http://x/"));
    expect(parsed.searchParams.get("destination")).toBe(DESTINATION);
    expect(parsed.searchParams.get("amount")).toBe("10.5");
  });

  it("includes asset_code and asset_issuer when a non-native asset is specified", () => {
    const uri = buildSep7PayUri({
      destination: DESTINATION,
      amount: "100",
      asset: { code: "USDC", issuer: ISSUER },
    });

    const parsed = new URL(uri.replace("web+stellar:", "http://x/"));
    expect(parsed.searchParams.get("asset_code")).toBe("USDC");
    expect(parsed.searchParams.get("asset_issuer")).toBe(ISSUER);
  });

  it("includes memo and memo_type when provided", () => {
    const uri = buildSep7PayUri({
      destination: DESTINATION,
      memo: "invoice-42",
      memoType: "MEMO_TEXT",
    });

    const parsed = new URL(uri.replace("web+stellar:", "http://x/"));
    expect(parsed.searchParams.get("memo")).toBe("invoice-42");
    expect(parsed.searchParams.get("memo_type")).toBe("MEMO_TEXT");
  });

  it("includes callback, msg, network_passphrase, origin_domain, and signature when provided", () => {
    const uri = buildSep7PayUri({
      destination: DESTINATION,
      callback: "url:https://example.com/callback",
      msg: "Pay for order #123",
      networkPassphrase: "Test SDF Network ; September 2015",
      originDomain: "example.com",
      signature: "c2lnbmF0dXJl",
    });

    const parsed = new URL(uri.replace("web+stellar:", "http://x/"));
    expect(parsed.searchParams.get("callback")).toBe(
      "url:https://example.com/callback",
    );
    expect(parsed.searchParams.get("msg")).toBe("Pay for order #123");
    expect(parsed.searchParams.get("network_passphrase")).toBe(
      "Test SDF Network ; September 2015",
    );
    expect(parsed.searchParams.get("origin_domain")).toBe("example.com");
    expect(parsed.searchParams.get("signature")).toBe("c2lnbmF0dXJl");
  });

  it("URL-encodes special characters in parameter values", () => {
    const uri = buildSep7PayUri({ destination: DESTINATION, memo: "a b&c=d" });

    expect(uri).not.toContain("a b&c=d");
    const parsed = new URL(uri.replace("web+stellar:", "http://x/"));
    expect(parsed.searchParams.get("memo")).toBe("a b&c=d");
  });

  it("throws when destination is missing", () => {
    expect(() => buildSep7PayUri({ destination: "" })).toThrow(/destination/i);
  });

  it("throws when asset is missing issuer", () => {
    expect(() =>
      buildSep7PayUri({
        destination: DESTINATION,
        asset: { code: "USDC", issuer: "" },
      }),
    ).toThrow(/asset/i);
  });

  it("throws when asset is missing code", () => {
    expect(() =>
      buildSep7PayUri({
        destination: DESTINATION,
        asset: { code: "", issuer: ISSUER },
      }),
    ).toThrow(/asset/i);
  });

  it("throws when msg exceeds 300 characters", () => {
    const longMsg = "a".repeat(301);
    expect(() =>
      buildSep7PayUri({ destination: DESTINATION, msg: longMsg }),
    ).toThrow(/300 characters/i);
  });

  it("accepts msg at exactly the 300-character boundary", () => {
    const boundaryMsg = "a".repeat(300);
    expect(() =>
      buildSep7PayUri({ destination: DESTINATION, msg: boundaryMsg }),
    ).not.toThrow();
  });
});

describe("parseSep7PayUri", () => {
  it("parses a minimal pay URI", () => {
    const result = parseSep7PayUri(
      `web+stellar:pay?destination=${DESTINATION}`,
    );

    expect(result).toEqual({ operation: "pay", destination: DESTINATION });
  });

  it("round-trips through buildSep7PayUri for a full set of fields", () => {
    const original: Parameters<typeof buildSep7PayUri>[0] = {
      destination: DESTINATION,
      amount: "42.5",
      asset: { code: "USDC", issuer: ISSUER },
      memo: "order-1",
      memoType: "MEMO_TEXT",
      callback: "url:https://example.com/cb",
      msg: "hello",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
      originDomain: "example.com",
      signature: "c2ln",
    };

    const uri = buildSep7PayUri(original);
    const parsed = parseSep7PayUri(uri);

    expect(parsed).toEqual({ operation: "pay", ...original });
  });

  it("parses the double-slash URI variant (web+stellar://pay?...)", () => {
    const result = parseSep7PayUri(
      `web+stellar://pay?destination=${DESTINATION}&amount=5`,
    );

    expect(result.destination).toBe(DESTINATION);
    expect(result.amount).toBe("5");
  });

  it("throws for a non web+stellar scheme", () => {
    expect(() =>
      parseSep7PayUri("https://example.com/pay?destination=GABC"),
    ).toThrow(/not a valid/i);
  });

  it("throws for an unsupported operation (e.g. tx)", () => {
    expect(() => parseSep7PayUri("web+stellar:tx?xdr=AAAA")).toThrow(
      /"pay" operation/i,
    );
  });

  it("throws when destination is missing", () => {
    expect(() => parseSep7PayUri("web+stellar:pay?amount=10")).toThrow(
      /destination/i,
    );
  });

  it("throws when asset_code is present without asset_issuer", () => {
    expect(() =>
      parseSep7PayUri(
        `web+stellar:pay?destination=${DESTINATION}&asset_code=USDC`,
      ),
    ).toThrow(/asset_code.*asset_issuer/i);
  });

  it("throws when asset_issuer is present without asset_code", () => {
    expect(() =>
      parseSep7PayUri(
        `web+stellar:pay?destination=${DESTINATION}&asset_issuer=${ISSUER}`,
      ),
    ).toThrow(/asset_code.*asset_issuer/i);
  });

  it("throws for an invalid memo_type", () => {
    expect(() =>
      parseSep7PayUri(
        `web+stellar:pay?destination=${DESTINATION}&memo_type=MEMO_BOGUS`,
      ),
    ).toThrow(/invalid "memo_type"/i);
  });

  it("throws for an empty or non-string input", () => {
    expect(() => parseSep7PayUri("")).toThrow();
    // @ts-expect-error - deliberately testing runtime guard against non-string input
    expect(() => parseSep7PayUri(null)).toThrow();
  });
});

describe("isSep7Uri", () => {
  it("returns true for a web+stellar: URI", () => {
    expect(isSep7Uri(`web+stellar:pay?destination=${DESTINATION}`)).toBe(true);
  });

  it("returns true for the double-slash variant", () => {
    expect(isSep7Uri(`web+stellar://pay?destination=${DESTINATION}`)).toBe(
      true,
    );
  });

  it("returns false for a plain address", () => {
    expect(isSep7Uri(DESTINATION)).toBe(false);
  });

  it("returns false for an unrelated URI scheme", () => {
    expect(isSep7Uri("https://example.com")).toBe(false);
  });

  it("returns false for non-string input", () => {
    // @ts-expect-error - deliberately testing runtime guard against non-string input
    expect(isSep7Uri(undefined)).toBe(false);
  });
});
