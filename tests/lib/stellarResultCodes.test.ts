import { decodeResultCodes } from "../../src/templates/default/src/lib/stellarResultCodes";

describe("decodeResultCodes", () => {
  it("prefers the first failing operation code over the transaction code", () => {
    const result = decodeResultCodes({
      transaction: "tx_failed",
      operations: ["op_success", "op_no_destination"],
    });
    expect(result.reason).toMatch(/destination account does not exist/i);
    expect(result.transactionCode).toBe("tx_failed");
    expect(result.operationCodes).toEqual(["op_success", "op_no_destination"]);
  });

  it("falls back to the transaction code description when no operation failed", () => {
    const result = decodeResultCodes({
      transaction: "tx_bad_seq",
      operations: ["op_success"],
    });
    expect(result.reason).toMatch(/sequence number does not match/i);
  });

  it("falls back to the raw code string for an unrecognized operation code", () => {
    const result = decodeResultCodes({ operations: ["op_some_future_code"] });
    expect(result.reason).toBe("Operation failed: op_some_future_code");
  });

  it("falls back to the raw code string for an unrecognized transaction code", () => {
    const result = decodeResultCodes({ transaction: "tx_some_future_code" });
    expect(result.reason).toBe("Transaction failed: tx_some_future_code");
  });

  it("returns a generic fallback when no codes object is provided at all", () => {
    expect(decodeResultCodes(undefined).reason).toBe(
      "Transaction failed for an unknown reason.",
    );
  });

  it("returns a generic fallback for an empty codes object", () => {
    expect(decodeResultCodes({}).reason).toBe(
      "Transaction failed for an unknown reason.",
    );
  });

  it("decodes op_underfunded, op_no_trust, and op_line_full distinctly", () => {
    expect(
      decodeResultCodes({ operations: ["op_underfunded"] }).reason,
    ).toMatch(/not have enough balance/i);
    expect(decodeResultCodes({ operations: ["op_no_trust"] }).reason).toMatch(
      /does not have a trustline/i,
    );
    expect(decodeResultCodes({ operations: ["op_line_full"] }).reason).toMatch(
      /limit for this asset would be exceeded/i,
    );
  });
});
