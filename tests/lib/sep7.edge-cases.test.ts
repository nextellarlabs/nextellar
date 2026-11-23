import {
  buildSep7PayUri,
  parseSep7PayUri,
  isSep7Uri,
  Sep7Error,
  type Sep7ErrorCode,
  type Sep7PayParams,
} from "../../src/templates/default/src/lib/sep7";

const DESTINATION = "GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ";
const ISSUER = "GISSUERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWJ4";

function sep7Error(run: () => unknown): Sep7Error {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(Sep7Error);
    return error as Sep7Error;
  }
  throw new Error("expected the call to throw a Sep7Error");
}

describe("memo types", () => {
  const types: Array<[NonNullable<Sep7PayParams["memoType"]>, string]> = [
    ["MEMO_TEXT", "invoice 42"],
    ["MEMO_ID", "123456789"],
    ["MEMO_HASH", "a".repeat(64)],
    ["MEMO_RETURN", "b".repeat(64)],
  ];

  it.each(types)("round-trips %s", (memoType, memo) => {
    const parsed = parseSep7PayUri(
      buildSep7PayUri({ destination: DESTINATION, memo, memoType }),
    );

    expect(parsed.memoType).toBe(memoType);
    expect(parsed.memo).toBe(memo);
  });

  it("emits memo_type exactly as given and does not default it when only memo is set", () => {
    const uri = buildSep7PayUri({ destination: DESTINATION, memo: "hello" });

    expect(uri).toContain("memo=hello");
    expect(uri).not.toContain("memo_type");
    expect(parseSep7PayUri(uri).memoType).toBeUndefined();
  });

  it("keeps an empty memo string (it is a value, not an absent field)", () => {
    const uri = buildSep7PayUri({ destination: DESTINATION, memo: "" });

    expect(uri).toContain("memo=");
    expect(parseSep7PayUri(uri).memo).toBe("");
  });

  it("rejects a lowercase or unknown memo_type with INVALID_MEMO_TYPE", () => {
    for (const bad of ["memo_text", "MEMO_NONE", "TEXT", ""]) {
      const uri = `web+stellar:pay?destination=${DESTINATION}&memo_type=${bad}`;
      expect(sep7Error(() => parseSep7PayUri(uri)).code).toBe(
        "INVALID_MEMO_TYPE",
      );
    }
  });

  it("preserves unicode and reserved characters in a text memo", () => {
    const memo = "café ☕ & 100% = ok?";
    const parsed = parseSep7PayUri(
      buildSep7PayUri({
        destination: DESTINATION,
        memo,
        memoType: "MEMO_TEXT",
      }),
    );

    expect(parsed.memo).toBe(memo);
  });
});

describe("asset parameters", () => {
  it("omits asset_code and asset_issuer for native XLM", () => {
    const uri = buildSep7PayUri({ destination: DESTINATION, amount: "1" });

    expect(uri).not.toContain("asset_code");
    expect(uri).not.toContain("asset_issuer");
    expect(parseSep7PayUri(uri).asset).toBeUndefined();
  });

  it("round-trips an issued asset including a 12 character code", () => {
    const asset = { code: "ABCDEFGHIJKL", issuer: ISSUER };
    const parsed = parseSep7PayUri(
      buildSep7PayUri({ destination: DESTINATION, asset }),
    );

    expect(parsed.asset).toEqual(asset);
  });

  it("keeps asset code case exactly as given", () => {
    const parsed = parseSep7PayUri(
      buildSep7PayUri({
        destination: DESTINATION,
        asset: { code: "UsDc", issuer: ISSUER },
      }),
    );

    expect(parsed.asset?.code).toBe("UsDc");
  });

  it("rejects half-specified assets when building, with INVALID_ASSET", () => {
    expect(
      sep7Error(() =>
        buildSep7PayUri({
          destination: DESTINATION,
          asset: { code: "USDC", issuer: "" },
        }),
      ).code,
    ).toBe("INVALID_ASSET");
    expect(
      sep7Error(() =>
        buildSep7PayUri({
          destination: DESTINATION,
          asset: { code: "", issuer: ISSUER },
        }),
      ).code,
    ).toBe("INVALID_ASSET");
  });

  it("rejects half-specified assets when parsing, with INVALID_ASSET", () => {
    const onlyCode = `web+stellar:pay?destination=${DESTINATION}&asset_code=USDC`;
    const onlyIssuer = `web+stellar:pay?destination=${DESTINATION}&asset_issuer=${ISSUER}`;

    expect(sep7Error(() => parseSep7PayUri(onlyCode)).code).toBe(
      "INVALID_ASSET",
    );
    expect(sep7Error(() => parseSep7PayUri(onlyIssuer)).code).toBe(
      "INVALID_ASSET",
    );
  });

  it("treats empty asset values as absent on both fields", () => {
    const uri = `web+stellar:pay?destination=${DESTINATION}&asset_code=&asset_issuer=`;

    expect(parseSep7PayUri(uri).asset).toBeUndefined();
  });
});

describe("URL encoding", () => {
  it("percent-encodes reserved characters in values", () => {
    const uri = buildSep7PayUri({
      destination: DESTINATION,
      msg: "a&b=c d+e%f",
    });
    const query = uri.slice(uri.indexOf("?") + 1);

    expect(query).not.toMatch(/msg=a&b/);
    expect(query).toContain("%26");
    expect(query).toContain("%3D");
    expect(query).toContain("%25");
    expect(parseSep7PayUri(uri).msg).toBe("a&b=c d+e%f");
  });

  it("round-trips a callback URL that has its own query string", () => {
    const callback = "https://example.com/cb?session=abc&x=1#frag";
    const parsed = parseSep7PayUri(
      buildSep7PayUri({ destination: DESTINATION, callback }),
    );

    expect(parsed.callback).toBe(callback);
  });

  it("round-trips a network passphrase containing spaces and semicolons", () => {
    const networkPassphrase = "Test SDF Network ; September 2015";
    const parsed = parseSep7PayUri(
      buildSep7PayUri({ destination: DESTINATION, networkPassphrase }),
    );

    expect(parsed.networkPassphrase).toBe(networkPassphrase);
  });

  it("round-trips a base64 signature with +, / and = characters", () => {
    const signature = "ab+/cd==";
    const parsed = parseSep7PayUri(
      buildSep7PayUri({ destination: DESTINATION, signature }),
    );

    expect(parsed.signature).toBe(signature);
  });

  it("decodes percent-encoded values from an externally built URI", () => {
    const uri = `web+stellar:pay?destination=${DESTINATION}&msg=Pay%20Alice%20%26%20Bob`;

    expect(parseSep7PayUri(uri).msg).toBe("Pay Alice & Bob");
  });

  it("leaves a plain destination unencoded", () => {
    expect(buildSep7PayUri({ destination: DESTINATION })).toBe(
      `web+stellar:pay?destination=${DESTINATION}`,
    );
  });
});

describe("malformed URIs return typed errors", () => {
  const cases: Array<[string, string, Sep7ErrorCode]> = [
    ["empty string", "", "INVALID_INPUT"],
    ["wrong scheme", "https://example.com/pay?destination=G", "INVALID_URI"],
    ["scheme only", "web+stellar:", "INVALID_URI"],
    [
      "no operation after the scheme",
      "web+stellar:?destination=G",
      "INVALID_URI",
    ],
    [
      "three slashes",
      `web+stellar:///pay?destination=${DESTINATION}`,
      "INVALID_URI",
    ],
    ["tx operation", "web+stellar:tx?xdr=AAAA", "UNSUPPORTED_OPERATION"],
    [
      "unknown operation",
      `web+stellar:swap?destination=${DESTINATION}`,
      "UNSUPPORTED_OPERATION",
    ],
    ["pay without a query string", "web+stellar:pay", "MISSING_DESTINATION"],
    [
      "empty destination value",
      "web+stellar:pay?destination=",
      "MISSING_DESTINATION",
    ],
    [
      "destination under another key",
      `web+stellar:pay?dest=${DESTINATION}`,
      "MISSING_DESTINATION",
    ],
  ];

  it.each(cases)("%s -> %s", (_label, uri, code) => {
    expect(sep7Error(() => parseSep7PayUri(uri)).code).toBe(code);
  });

  it("rejects non-string input with INVALID_INPUT", () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(sep7Error(() => parseSep7PayUri(bad as never)).code).toBe(
        "INVALID_INPUT",
      );
    }
  });

  it("builds typed errors for missing or blank destinations and oversize messages", () => {
    expect(sep7Error(() => buildSep7PayUri({ destination: "" })).code).toBe(
      "MISSING_DESTINATION",
    );
    expect(sep7Error(() => buildSep7PayUri({ destination: "   " })).code).toBe(
      "MISSING_DESTINATION",
    );
    expect(
      sep7Error(() =>
        buildSep7PayUri({ destination: DESTINATION, msg: "x".repeat(301) }),
      ).code,
    ).toBe("MSG_TOO_LONG");
  });

  it("keeps the original, human-readable messages", () => {
    expect(
      sep7Error(() => parseSep7PayUri("web+stellar:tx?xdr=AAAA")).message,
    ).toMatch(/expected a "pay" operation/);
    expect(
      sep7Error(() => buildSep7PayUri({ destination: "" })).message,
    ).toMatch(/"destination" is required/);
  });

  it("stays an Error so existing catch blocks and toThrow assertions keep working", () => {
    const error = sep7Error(() => parseSep7PayUri(""));

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("Sep7Error");
  });
});

describe("parser tolerance", () => {
  it("accepts an uppercase scheme and operation", () => {
    const parsed = parseSep7PayUri(
      `WEB+STELLAR:PAY?destination=${DESTINATION}`,
    );

    expect(parsed.operation).toBe("pay");
    expect(parsed.destination).toBe(DESTINATION);
  });

  it("accepts a trailing question mark followed by parameters and ignores unknown parameters", () => {
    const parsed = parseSep7PayUri(
      `web+stellar:pay?destination=${DESTINATION}&future_param=1`,
    );

    expect(parsed).toEqual({ operation: "pay", destination: DESTINATION });
  });

  it("uses the first value when a parameter is repeated", () => {
    const other = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    const parsed = parseSep7PayUri(
      `web+stellar:pay?destination=${DESTINATION}&destination=${other}`,
    );

    expect(parsed.destination).toBe(DESTINATION);
  });

  it("does not trim a destination it was given (validation of the address is the caller's job)", () => {
    const parsed = parseSep7PayUri("web+stellar:pay?destination=%20GABC%20");

    expect(parsed.destination).toBe(" GABC ");
  });

  it("isSep7Uri is case-insensitive and false for tx-like lookalikes", () => {
    expect(isSep7Uri("WEB+STELLAR:tx?xdr=AAAA")).toBe(true);
    expect(isSep7Uri("web+stellarx:pay?destination=G")).toBe(false);
    expect(isSep7Uri(" web+stellar:pay")).toBe(false);
  });
});
