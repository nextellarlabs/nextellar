import {
  describePath,
  fromStroops,
  isValidAmount,
  maxSendAmount,
  minReceiveAmount,
  parsePathRecord,
  sameAsset,
  selectBestPath,
  toStroops,
  type HorizonPathRecord,
  type PathQuote,
} from "../../src/templates/defi/src/lib/pathPayment";

const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = { code: "USDC", issuer: ISSUER };

function quote(sourceAmount: string, destinationAmount: string): PathQuote {
  return {
    sourceAsset: "XLM",
    sourceAmount,
    destinationAsset: USDC,
    destinationAmount,
    path: [],
  };
}

describe("stroop conversion", () => {
  it("round-trips amounts without floating point error", () => {
    expect(toStroops("0.1")).toBe(BigInt(1000000));
    expect(toStroops("12.3456789")).toBe(BigInt(123456789));
    expect(fromStroops(toStroops("12.3456789"))).toBe("12.3456789");
    expect(fromStroops(BigInt(1))).toBe("0.0000001");
  });

  it("rejects malformed amounts", () => {
    expect(() => toStroops("1.12345678")).toThrow("Invalid amount");
    expect(() => toStroops("-1")).toThrow("Invalid amount");
    expect(() => toStroops("abc")).toThrow("Invalid amount");
  });

  it("validates positive amounts only", () => {
    expect(isValidAmount("1")).toBe(true);
    expect(isValidAmount("0")).toBe(false);
    expect(isValidAmount("0.0000000")).toBe(false);
    expect(isValidAmount("")).toBe(false);
    expect(isValidAmount("1e5")).toBe(false);
  });
});

describe("slippage bounds", () => {
  it("strict-send: minimum received is reduced by the tolerance", () => {
    expect(minReceiveAmount("100.0000000", 100)).toBe("99.0000000");
    expect(minReceiveAmount("100.0000000", 0)).toBe("100.0000000");
    expect(minReceiveAmount("100.0000000", 5000)).toBe("50.0000000");
  });

  it("strict-receive: maximum sent is increased by the tolerance", () => {
    expect(maxSendAmount("100.0000000", 100)).toBe("101.0000000");
    expect(maxSendAmount("100.0000000", 0)).toBe("100.0000000");
    expect(maxSendAmount("100.0000000", 5000)).toBe("150.0000000");
  });

  it("rounds toward the protective direction at stroop precision", () => {
    // 0.0000001 * 99.99% = 0.00000009999 -> rounds up to 1 stroop, never 0.
    expect(minReceiveAmount("0.0000001", 1)).toBe("0.0000001");
    // 0.0000001 * 100.01% = 0.000000100010 -> rounds up to 2 stroops.
    expect(maxSendAmount("0.0000001", 1)).toBe("0.0000002");
  });

  it.each([-1, 5001, 1.5, Number.NaN])("rejects slippage of %p bps", (bps) => {
    expect(() => minReceiveAmount("1", bps)).toThrow("Slippage must be");
    expect(() => maxSendAmount("1", bps)).toThrow("Slippage must be");
  });
});

describe("Horizon path parsing", () => {
  const record: HorizonPathRecord = {
    source_asset_type: "native",
    source_amount: "10.0000000",
    destination_asset_type: "credit_alphanum4",
    destination_asset_code: "USDC",
    destination_asset_issuer: ISSUER,
    destination_amount: "1.2500000",
    path: [
      {
        asset_type: "credit_alphanum4",
        asset_code: "BTC",
        asset_issuer: ISSUER,
      },
    ],
  };

  it("maps native and issued assets and the intermediate hops", () => {
    const parsed = parsePathRecord(record);
    expect(parsed.sourceAsset).toBe("XLM");
    expect(parsed.destinationAsset).toEqual(USDC);
    expect(parsed.path).toEqual([{ code: "BTC", issuer: ISSUER }]);
    expect(describePath(parsed)).toBe("XLM → BTC → USDC");
  });

  it("describes a direct route without intermediate hops", () => {
    expect(describePath(parsePathRecord({ ...record, path: [] }))).toBe(
      "XLM → USDC",
    );
  });

  it("throws on an issued asset missing its issuer", () => {
    expect(() =>
      parsePathRecord({ ...record, destination_asset_issuer: undefined }),
    ).toThrow("Malformed asset");
  });
});

describe("selectBestPath", () => {
  const quotes = [quote("10", "1.0"), quote("10", "1.3"), quote("10", "1.1")];

  it("returns null when there are no routes", () => {
    expect(selectBestPath([], "strict-send")).toBeNull();
  });

  it("strict-send picks the route delivering the most", () => {
    expect(selectBestPath(quotes, "strict-send")?.destinationAmount).toBe(
      "1.3",
    );
  });

  it("strict-receive picks the route costing the least", () => {
    const costs = [quote("12", "5"), quote("9.5", "5"), quote("11", "5")];
    expect(selectBestPath(costs, "strict-receive")?.sourceAmount).toBe("9.5");
  });
});

describe("sameAsset", () => {
  it("compares native and issued assets", () => {
    expect(sameAsset("XLM", "XLM")).toBe(true);
    expect(sameAsset("XLM", USDC)).toBe(false);
    expect(sameAsset(USDC, { ...USDC })).toBe(true);
    expect(sameAsset(USDC, { code: "USDC", issuer: "OTHER" })).toBe(false);
  });
});
