/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Module mocking (must be top-level awaited before any dynamic imports) ─────
//
// We use jest.unstable_mockModule (the ESM-native equivalent of jest.mock) so
// that the real @stellar/stellar-sdk is never loaded — this avoids the
// concurrent-require/import conflict caused by the hook's .js ESM module.
// All SDK constructors are mocked here; each test overrides them as needed.

const mockSimulateTransaction = jest.fn();
const mockSendTransaction = jest.fn();
const mockRpcServerConstructor = jest.fn(() => ({
  simulateTransaction: mockSimulateTransaction,
  sendTransaction: mockSendTransaction,
}));

// Minimal xdr stubs
const mockXdr = {
  ScVal: {
    scvString: (s: string) => ({ switch: () => ({ name: "scvString" }), str: () => ({ toString: () => s }), _tag: "string", _val: s }),
    scvI32: (n: number) => ({ switch: () => ({ name: "scvI32" }), i32: () => n, _tag: "i32", _val: n }),
    scvBool: (b: boolean) => ({ switch: () => ({ name: "scvBool" }), b: () => b, _tag: "bool", _val: b }),
    scvVec: (items: unknown[]) => ({ switch: () => ({ name: "scvVec" }), vec: () => items }),
    scvMap: (entries: unknown[]) => ({ switch: () => ({ name: "scvMap" }), map: () => entries }),
    scvSymbol: (s: string) => ({ switch: () => ({ name: "scvSymbol" }), sym: () => ({ toString: () => s }) }),
  },
  ScValType: {
    scvString: () => ({ name: "scvString" }),
    scvI32: () => ({ name: "scvI32" }),
    scvBool: () => ({ name: "scvBool" }),
    scvVec: () => ({ name: "scvVec" }),
    scvMap: () => ({ name: "scvMap" }),
    scvSymbol: () => ({ name: "scvSymbol" }),
    scvVoid: () => ({ name: "scvVoid" }),
    scvU32: () => ({ name: "scvU32" }),
    scvI64: () => ({ name: "scvI64" }),
    scvU64: () => ({ name: "scvU64" }),
    scvU128: () => ({ name: "scvU128" }),
    scvI128: () => ({ name: "scvI128" }),
    scvBytes: () => ({ name: "scvBytes" }),
    scvAddress: () => ({ name: "scvAddress" }),
    scvTimepoint: () => ({ name: "scvTimepoint" }),
    scvDuration: () => ({ name: "scvDuration" }),
  },
  ScMapEntry: jest.fn(),
  Uint64: { fromString: (s: string) => s },
  Int64: { fromString: (s: string) => s },
  UInt128Parts: jest.fn(),
  Int128Parts: jest.fn(),
};

const mockContractCall = jest.fn(() => ({ _op: "invoke" }));
const mockContractConstructor = jest.fn(() => ({ call: mockContractCall }));

const mockTransaction = {
  toXDR: jest.fn(() => "AAAAAAAAAAAAAAAA"),
  sign: jest.fn(),
};
const mockTxBuilder = {
  addOperation: jest.fn().mockReturnThis(),
  setTimeout: jest.fn().mockReturnThis(),
  build: jest.fn(() => mockTransaction),
};
const mockTransactionBuilderConstructor = jest.fn(() => mockTxBuilder);
// fromXDR is a static method
(mockTransactionBuilderConstructor as unknown as Record<string, unknown>).fromXDR = jest.fn(() => mockTransaction);

const mockKeypair = { publicKey: jest.fn(() => "GDUMMY_KEY") };
const mockKeypairRandom = jest.fn(() => mockKeypair);
const mockKeypairFromSecret = jest.fn(() => mockKeypair);

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: mockRpcServerConstructor,
  },
  xdr: mockXdr,
  Address: {
    fromString: jest.fn((s: string) => ({
      toScVal: () => ({ switch: () => ({ name: "scvAddress" }), _addr: s }),
    })),
  },
  Contract: mockContractConstructor,
  Account: jest.fn(() => ({ accountId: () => "GDUMMY", sequenceNumber: () => "0" })),
  TransactionBuilder: mockTransactionBuilderConstructor,
  Networks: { TESTNET: "Test SDF Network ; September 2015", PUBLIC: "Public Global Stellar Network ; September 2015" },
  Keypair: { random: mockKeypairRandom, fromSecret: mockKeypairFromSecret },
  StrKey: {
    isValidContract: jest.fn((id: string) => id.startsWith("C") && id.length === 56),
  },
}));

// Import the hook AFTER mocking the SDK
const { useSorobanContract } = await import(
  "../../src/templates/js-template/src/hooks/useSorobanContract.js"
);

// ── Constants ─────────────────────────────────────────────────────────────────

const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const VALID_CONTRACT_ID = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";
const VALID_ACCOUNT_ADDRESS = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStringScVal(s: string) {
  return {
    switch: () => mockXdr.ScValType.scvString(),
    str: () => ({ toString: () => s }),
  };
}

function makeI32ScVal(n: number) {
  return {
    switch: () => mockXdr.ScValType.scvI32(),
    i32: () => n,
  };
}

function makeBoolScVal(b: boolean) {
  return {
    switch: () => mockXdr.ScValType.scvBool(),
    b: () => b,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useSorobanContract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRpcServerConstructor.mockImplementation(() => ({
      simulateTransaction: mockSimulateTransaction,
      sendTransaction: mockSendTransaction,
    }));
    mockTxBuilder.addOperation.mockReturnThis();
    mockTxBuilder.setTimeout.mockReturnThis();
    mockTxBuilder.build.mockReturnValue(mockTransaction);
    mockTransactionBuilderConstructor.mockImplementation(() => mockTxBuilder);
    (mockTransactionBuilderConstructor as unknown as Record<string, unknown>).fromXDR = jest.fn(() => mockTransaction);
  });

  // ── callFunction ─────────────────────────────────────────────────────────

  it("invokeContract read-only flow returns parsed result", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: makeStringScVal("hello") },
    });

    const { result } = renderHook(() =>
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
    );

    let output: unknown;
    await act(async () => {
      output = await result.current.callFunction("greet", []);
    });

    expect(output).toBe("hello");
  });

  it("toXdrValue converts string/number/boolean (verifies Contract.call args)", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: makeBoolScVal(true) },
    });

    const { result } = renderHook(() =>
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
    );

    await act(async () => {
      await result.current.callFunction("set_primitives", ["hello", 42, true]);
    });

    // Contract.call should have been invoked with converted XDR args
    expect(mockContractCall).toHaveBeenCalledWith(
      "set_primitives",
      expect.anything(), // string → scvString
      expect.anything(), // number → scvI32
      expect.anything(), // boolean → scvBool
    );
  });

  it("fromXdrValue converts i32", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: makeI32ScVal(7) },
    });

    const { result } = renderHook(() =>
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
    );

    let output: unknown;
    await act(async () => {
      output = await result.current.callFunction("get_count", []);
    });

    expect(output).toBe(7);
  });

  it("fromXdrValue converts bool", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: makeBoolScVal(false) },
    });

    const { result } = renderHook(() =>
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
    );

    let output: unknown;
    await act(async () => {
      output = await result.current.callFunction("is_paused", []);
    });

    expect(output).toBe(false);
  });

  it("buildInvokeXDR returns a non-empty base64 string", async () => {
    const { result } = renderHook(() =>
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
    );

    let txXdr = "";
    await act(async () => {
      txXdr = await result.current.buildInvokeXDR("ping", ["value"]);
    });

    expect(typeof txXdr).toBe("string");
    expect(txXdr.length).toBeGreaterThan(0);
  });

  it("invalid contract ID throws immediately", () => {
    expect(() =>
      renderHook(() =>
        useSorobanContract({ contractId: "invalid-contract-id", sorobanRpc: SOROBAN_RPC_URL })
      )
    ).toThrow(/Invalid Soroban contract ID/);
  });

  it("simulation RPC error is surfaced through error state", async () => {
    mockSimulateTransaction.mockRejectedValue(new Error("RPC unavailable"));

    const { result } = renderHook(() =>
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
    );

    let thrown: Error | undefined;
    await act(async () => {
      try {
        await result.current.callFunction("will_fail", []);
      } catch (error) {
        thrown = error as Error;
      }
    });

    expect(thrown?.message).toContain("RPC unavailable");
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  });

  it("simulation error field in response is surfaced", async () => {
    mockSimulateTransaction.mockResolvedValue({
      error: "simulated host function failure",
    });

    const { result } = renderHook(() =>
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
    );

    let thrown: Error | undefined;
    await act(async () => {
      try {
        await result.current.callFunction("will_fail_sim", []);
      } catch (error) {
        thrown = error as Error;
      }
    });

    expect(thrown?.message).toContain("simulated host function failure");
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  // ── simulateContractCall ────────────────────────────────────────────────────

  it("simulateContractCall returns decoded result and fee info", async () => {
    mockSimulateTransaction.mockResolvedValue({
      result: { retval: makeStringScVal("preview-ok") },
      minResourceFee: "500",
      latestLedger: 9999,
    });

    const { result } = renderHook(() =>
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
    );

    let preview: { result: unknown; minResourceFee: string; latestLedger: number } | undefined;
    await act(async () => {
      preview = await result.current.simulateContractCall("get_value", []);
    });

    expect(preview).toBeDefined();
    expect(preview!.result).toBe("preview-ok");
    expect(preview!.minResourceFee).toBe("500");
    expect(preview!.latestLedger).toBe(9999);
  });

  it("simulateContractCall returns null result when retval absent", async () => {
    mockSimulateTransaction.mockResolvedValue({
      minResourceFee: "200",
      latestLedger: 1234,
    });

    const { result } = renderHook(() =>
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
    );

    let preview: { result: unknown; minResourceFee: string; latestLedger: number } | undefined;
    await act(async () => {
      preview = await result.current.simulateContractCall("no_return", []);
    });

    expect(preview!.result).toBeNull();
    expect(preview!.minResourceFee).toBe("200");
    expect(preview!.latestLedger).toBe(1234);
  });

  it("simulateContractCall surfaces simulation error and sets error state", async () => {
    mockSimulateTransaction.mockResolvedValue({
      error: "contract reverted with panic",
    });

    const { result } = renderHook(() =>
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
    );

    let thrown: Error | undefined;
    await act(async () => {
      try {
        await result.current.simulateContractCall("bad_fn", []);
      } catch (error) {
        thrown = error as Error;
      }
    });

    expect(thrown?.message).toContain("Simulation failed");
    expect(thrown?.message).toContain("contract reverted");
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  });

  it("simulateContractCall sets loading true during call and false after", async () => {
    let resolveSimulation!: (value: unknown) => void;
    const pending = new Promise((res) => {
      resolveSimulation = res;
    });
    mockSimulateTransaction.mockReturnValue(pending);

    const { result } = renderHook(() =>
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
    );

    // Start the call without awaiting
    let callPromise!: Promise<unknown>;
    act(() => {
      callPromise = result.current.simulateContractCall("slow_fn", []);
    });

    await waitFor(() => expect(result.current.loading).toBe(true));

    // Resolve and finish
    resolveSimulation({
      result: { retval: makeBoolScVal(true) },
      minResourceFee: "100",
      latestLedger: 42,
    });

    await act(async () => {
      await callPromise;
    });

    expect(result.current.loading).toBe(false);
  });

  it("simulateContractCall is exposed on the hook return value", () => {
    const { result } = renderHook(() =>
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
    );

    expect(typeof result.current.simulateContractCall).toBe("function");
  });
});
