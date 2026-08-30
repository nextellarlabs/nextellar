/**
 * @jest-environment jsdom
 *
 * Regression coverage for #844: submitSignedXDR must decode and surface
 * Stellar result codes (e.g. tx_failed / op_no_destination) as a readable
 * reason, not a generic "Transaction failed" message.
 *
 * Unlike useStellarPayment.test.ts (which mocks the hook itself), this file
 * imports and exercises the REAL hook, mocking only its @stellar/stellar-sdk
 * dependency — so the actual decoding branch in submitSignedXDR is under
 * test, not a stand-in.
 */
import { jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";

const mockLoadAccount = jest.fn();
const mockSubmitTransaction = jest.fn();

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmitTransaction,
    })),
  },
  Keypair: { fromSecret: jest.fn() },
  TransactionBuilder: jest.fn(),
  Operation: { payment: jest.fn() },
  Networks: {
    TESTNET: "Test SDF Network ; September 2015",
    PUBLIC: "Public Global Stellar Network ; September 2015",
  },
  Asset: { native: jest.fn() },
  Memo: { text: jest.fn() },
  BASE_FEE: "100",
  // The real submitSignedXDR does `new Transaction(signedXdrBase64, passphrase)`
  // purely to hand it to submitTransaction — it never reads any field off it
  // itself, so an empty constructed object is sufficient here.
  Transaction: jest.fn().mockImplementation(() => ({})),
}));

const { useStellarPayment } =
  await import("../../src/templates/default/src/hooks/useStellarPayment.js");

// A syntactically valid-looking base64 string, long enough to pass
// submitSignedXDR's own sanity check (>50 chars, base64 charset).
const SIGNED_XDR = "A".repeat(60) + "==";

function horizonError(overrides: {
  status?: number;
  result_codes?: { transaction?: string; operations?: string[] };
}) {
  return {
    response: {
      status: overrides.status ?? 400,
      data: overrides.result_codes
        ? { extras: { result_codes: overrides.result_codes } }
        : undefined,
    },
    message: "Bad Request",
  };
}

describe("useStellarPayment — result code decoding (#844)", () => {
  let consoleErrorSpy: any;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("surfaces a readable reason for op_no_destination (unfunded/missing destination)", async () => {
    mockSubmitTransaction.mockRejectedValue(
      horizonError({
        result_codes: {
          transaction: "tx_failed",
          operations: ["op_no_destination"],
        },
      }),
    );

    const { result } = renderHook(() => useStellarPayment());

    let paymentResult: any;
    await act(async () => {
      paymentResult = await result.current.submitSignedXDR(SIGNED_XDR);
    });

    expect(paymentResult.success).toBe(false);
    expect(paymentResult.error).toMatch(/destination account does not exist/i);
    expect(paymentResult.resultCodes).toEqual({
      transaction: "tx_failed",
      operations: ["op_no_destination"],
    });
  });

  it("surfaces a readable reason for op_underfunded", async () => {
    mockSubmitTransaction.mockRejectedValue(
      horizonError({
        result_codes: {
          transaction: "tx_failed",
          operations: ["op_underfunded"],
        },
      }),
    );

    const { result } = renderHook(() => useStellarPayment());

    let paymentResult: any;
    await act(async () => {
      paymentResult = await result.current.submitSignedXDR(SIGNED_XDR);
    });

    expect(paymentResult.success).toBe(false);
    expect(paymentResult.error).toMatch(/not have enough balance/i);
    expect(paymentResult.resultCodes?.operations).toEqual(["op_underfunded"]);
  });

  it("falls back to the transaction-level code when no operation code is available", async () => {
    mockSubmitTransaction.mockRejectedValue(
      horizonError({ result_codes: { transaction: "tx_bad_seq" } }),
    );

    const { result } = renderHook(() => useStellarPayment());

    let paymentResult: any;
    await act(async () => {
      paymentResult = await result.current.submitSignedXDR(SIGNED_XDR);
    });

    expect(paymentResult.success).toBe(false);
    expect(paymentResult.error).toMatch(/sequence number does not match/i);
    expect(paymentResult.resultCodes).toEqual({
      transaction: "tx_bad_seq",
      operations: undefined,
    });
  });

  it("still succeeds and returns a hash when submission succeeds", async () => {
    mockSubmitTransaction.mockResolvedValue({
      hash: "tx_hash_abc",
      successful: true,
    });

    const { result } = renderHook(() => useStellarPayment());

    let paymentResult: any;
    await act(async () => {
      paymentResult = await result.current.submitSignedXDR(SIGNED_XDR);
    });

    expect(paymentResult.success).toBe(true);
    expect(paymentResult.txHash).toBe("tx_hash_abc");
    expect(paymentResult.resultCodes).toBeUndefined();
  });

  it("falls back to a generic message for non-result-code HTTP errors", async () => {
    mockSubmitTransaction.mockRejectedValue(horizonError({ status: 500 }));

    const { result } = renderHook(() => useStellarPayment());

    let paymentResult: any;
    await act(async () => {
      paymentResult = await result.current.submitSignedXDR(SIGNED_XDR);
    });

    expect(paymentResult.success).toBe(false);
    expect(paymentResult.error).toBe("Horizon server error during submission");
    expect(paymentResult.resultCodes).toBeUndefined();
  });
});
