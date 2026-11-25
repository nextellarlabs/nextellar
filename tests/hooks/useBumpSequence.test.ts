/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import { act, renderHook } from "@testing-library/react";

const MockServer = jest.fn();
const MockTransactionBuilder = jest.fn();
const mockLoadAccount = jest.fn();
const mockSubmitTransaction = jest.fn();
const mockFromSecret = jest.fn();
const mockBumpSequence = jest.fn();
const TESTNET = "Test SDF Network ; September 2015";
const PUBLIC = "Public Global Stellar Network ; September 2015";

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: { Server: MockServer },
  Keypair: { fromSecret: mockFromSecret },
  TransactionBuilder: MockTransactionBuilder,
  Operation: { bumpSequence: mockBumpSequence },
  Networks: { TESTNET, PUBLIC },
  BASE_FEE: "100",
}));

const { useBumpSequence } =
  await import("../../src/templates/default/src/hooks/useBumpSequence.js");

const PUBLIC_KEY = "GABC".padEnd(56, "X");
const SECRET = "SABC".padEnd(56, "X");
const ACCOUNT = { sequenceNumber: () => "100" };
const TARGET = "150";

type Builder = {
  addOperation: jest.Mock;
  setTimeout: jest.Mock;
  build: jest.Mock;
};

describe("useBumpSequence", () => {
  let builder: Builder;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockLoadAccount.mockResolvedValue(ACCOUNT);
    mockSubmitTransaction.mockResolvedValue({ hash: "hash_123" });
    MockServer.mockImplementation(() => ({
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmitTransaction,
    }));
    builder = {
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn(() => ({ sign: jest.fn() })),
    };
    MockTransactionBuilder.mockImplementation(() => builder);
    mockBumpSequence.mockImplementation((opts: unknown) => ({
      type: "bumpSequence",
      opts,
    }));
    mockFromSecret.mockReturnValue({ publicKey: () => PUBLIC_KEY });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("submits a bump with the configured passphrase and returns the new sequence and hash", async () => {
    const { result } = renderHook(() => useBumpSequence({ network: "PUBLIC" }));
    let response!: Awaited<
      ReturnType<ReturnType<typeof useBumpSequence>["bumpSequence"]>
    >;

    await act(async () => {
      response = await result.current.bumpSequence({
        publicKey: PUBLIC_KEY,
        targetSequence: TARGET,
        secret: SECRET,
      });
    });

    expect(response).toMatchObject({
      success: true,
      newSequence: TARGET,
      hash: "hash_123",
    });
    expect(MockTransactionBuilder).toHaveBeenCalledWith(ACCOUNT, {
      fee: "100",
      networkPassphrase: PUBLIC,
    });
    expect(mockBumpSequence).toHaveBeenCalledWith({ bumpTo: TARGET });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("rejects a target sequence that is not greater than the current sequence", async () => {
    const { result } = renderHook(() => useBumpSequence());

    await act(async () => {
      const response = await result.current.bumpSequence({
        publicKey: PUBLIC_KEY,
        targetSequence: "100",
        secret: SECRET,
      });
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/greater than current sequence/);
    });

    expect(mockSubmitTransaction).not.toHaveBeenCalled();
    expect(result.current.error?.message).toMatch(/greater than current sequence/);
  });

  it("surfaces Horizon result codes from a failed submission", async () => {
    mockSubmitTransaction.mockRejectedValue({
      message: "Request failed with status code 400",
      response: {
        status: 400,
        data: { extras: { result_codes: { transaction: "tx_bad_seq" } } },
      },
    });
    const { result } = renderHook(() => useBumpSequence());

    await act(async () => {
      const response = await result.current.bumpSequence({
        publicKey: PUBLIC_KEY,
        targetSequence: TARGET,
        secret: SECRET,
      });
      expect(response.success).toBe(false);
      expect(response.error).toBe("Transaction failed - tx_bad_seq");
    });

    expect(result.current.error?.message).toBe("Transaction failed - tx_bad_seq");
    expect(result.current.loading).toBe(false);
  });
});
