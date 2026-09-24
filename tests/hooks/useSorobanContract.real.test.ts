/**
 * @jest-environment jsdom
 *
 * Unit tests for the real `useSorobanContract` template hook (issue #822).
 *
 * The pre-existing `tests/hooks/useSorobanContract.test.ts` targets the
 * `js-template` copy of the hook and currently fails to run at all — Jest
 * loads that `.js` file as CJS and chokes on its `import` statements. This
 * suite targets the TypeScript hook under `src/templates/default`, which the
 * Babel transform handles, so the behaviour is actually exercised.
 *
 * Only `rpc.Server` — the Soroban RPC boundary — is stubbed. `Contract`,
 * `TransactionBuilder`, `Keypair` and the `xdr` codec stay real, so the
 * arguments the hook encodes and the return values it decodes go through the
 * genuine ScVal representation rather than a hand-written stand-in.
 *
 * Covers the issue's acceptance criteria:
 *   - a successful call/invoke
 *   - a simulation error path
 *   - the Soroban RPC is mocked
 */

import { jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";

// soroban-rpc responses are only partially constructed by these tests, so the
// mocks are typed loosely: a bare `jest.fn()` from '@jest/globals' infers its
// parameters as `never`, which would make every mockResolvedValue below a
// type error.
type AnyAsyncMock = jest.Mock<(...args: never[]) => Promise<unknown>>;

const mockSimulateTransaction = jest.fn() as AnyAsyncMock;
const mockSendTransaction = jest.fn() as AnyAsyncMock;
const mockRpcServerConstructor = jest.fn() as jest.Mock<
  (...args: never[]) => unknown
>;

mockRpcServerConstructor.mockImplementation(() => ({
  simulateTransaction: mockSimulateTransaction,
  sendTransaction: mockSendTransaction,
}));

// `requireActual` is load-bearing: importing the SDK inside the factory would
// resolve back to the mock itself and the Jest worker dies on the cycle.
await jest.unstable_mockModule("@stellar/stellar-sdk", async () => {
  const actual = await jest.requireActual<Record<string, unknown>>(
    "@stellar/stellar-sdk",
  );
  return {
    ...actual,
    rpc: {
      ...(actual.rpc as Record<string, unknown>),
      Server: mockRpcServerConstructor,
    },
  };
});

// Pull the SDK through the mocked specifier so the hook and the test agree on
// class identity for the values crossing between them.
const { xdr, Address, Keypair, StrKey, Networks, TransactionBuilder } =
  (await import("@stellar/stellar-sdk")) as unknown as typeof import("@stellar/stellar-sdk");

// The bindings above are values and cannot be used in type position, so alias
// the SDK types the annotations below need.
type ScVal = import("@stellar/stellar-sdk").xdr.ScVal;
type HostFunction = import("@stellar/stellar-sdk").xdr.HostFunction;

const { useSorobanContract, isValidContractId } =
  await import("../../src/templates/default/src/hooks/useSorobanContract.js");

// ── Fixtures ────────────────────────────────────────────────────────────────

// Deterministic, StrKey-valid contract address.
const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 3));
const OTHER_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 5));

const SIGNER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const ACCOUNT_ADDRESS = SIGNER_KP.publicKey();

/** A successful simulation carrying `retval`, as soroban-rpc returns. */
function simulationSuccess(retval: ScVal) {
  return {
    id: "sim-1",
    latestLedger: 100,
    result: { retval, auth: [] },
    transactionData: {},
    minResourceFee: "100",
  };
}

/** A simulation that failed inside the host, e.g. a panicking contract. */
function simulationFailure(error = "HostError: Error(Contract, #3)") {
  return { id: "sim-1", latestLedger: 100, error };
}

function renderContractHook(
  opts: { contractId?: string; sorobanRpc?: string } = {},
) {
  const { contractId = CONTRACT_ID, ...rest } = opts;
  return renderHook(() => useSorobanContract({ contractId, ...rest }));
}

/**
 * Await a hook call that is expected to reject, and return the rejection.
 *
 * The rejection has to be caught *inside* `act` so React can flush the
 * `setError` that the hook performs on its way out. Wrapping the whole `act`
 * in `expect(...).rejects` instead lets the rejection escape before that
 * state update commits, and the hook's `error` still reads `null`.
 */
async function expectRejection(run: () => Promise<unknown>): Promise<Error> {
  let caught: Error | undefined;
  await act(async () => {
    await run().catch((err: Error) => {
      caught = err;
    });
  });
  if (!caught) {
    throw new Error("expected the call to reject, but it resolved");
  }
  return caught;
}

describe("useSorobanContract (real template hook)", () => {
  beforeEach(() => {
    mockSimulateTransaction.mockReset();
    mockSendTransaction.mockReset();
    mockRpcServerConstructor.mockClear();
    mockRpcServerConstructor.mockImplementation(() => ({
      simulateTransaction: mockSimulateTransaction,
      sendTransaction: mockSendTransaction,
    }));
  });

  // ── Contract ID validation ────────────────────────────────────────────────

  describe("contract id validation", () => {
    it("accepts a StrKey-encoded contract address", () => {
      expect(isValidContractId(CONTRACT_ID)).toBe(true);
      // Surrounding whitespace is tolerated.
      expect(isValidContractId(`  ${CONTRACT_ID}  `)).toBe(true);
    });

    it.each([
      ["an empty string", ""],
      ["whitespace only", "   "],
      ["an account address", ACCOUNT_ADDRESS],
      ["a truncated id", CONTRACT_ID.slice(0, 20)],
    ])("rejects %s", (_label, value) => {
      expect(isValidContractId(value)).toBe(false);
    });

    it("throws on render when constructed with an invalid contract id", () => {
      // The hook fails fast rather than deferring to the first call, so a
      // misconfigured .env surfaces at mount.
      expect(() =>
        renderContractHook({ contractId: "not-a-contract" }),
      ).toThrow(/Invalid Soroban contract ID/i);
    });
  });

  // ── Successful call ───────────────────────────────────────────────────────

  describe("a successful call", () => {
    it("simulates a read-only call and decodes the return value", async () => {
      mockSimulateTransaction.mockResolvedValue(
        simulationSuccess(xdr.ScVal.scvU32(42)),
      );

      const { result } = renderContractHook();

      let value: unknown;
      await act(async () => {
        value = await result.current.callFunction("get_count", []);
      });

      expect(value).toBe(42);
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
    });

    it("decodes each scalar return type", async () => {
      const { result } = renderContractHook();

      const cases: Array<[ScVal, unknown]> = [
        [xdr.ScVal.scvI32(-7), -7],
        [xdr.ScVal.scvBool(true), true],
        [xdr.ScVal.scvString("hello"), "hello"],
        [xdr.ScVal.scvSymbol("Ok"), "Ok"],
        [xdr.ScVal.scvVoid(), null],
      ];

      for (const [retval, expected] of cases) {
        mockSimulateTransaction.mockResolvedValue(simulationSuccess(retval));
        let value: unknown;
        await act(async () => {
          value = await result.current.callFunction("read", []);
        });
        expect(value).toEqual(expected);
      }
    });

    it("decodes a vec return value", async () => {
      mockSimulateTransaction.mockResolvedValue(
        simulationSuccess(
          xdr.ScVal.scvVec([xdr.ScVal.scvU32(1), xdr.ScVal.scvU32(2)]),
        ),
      );

      const { result } = renderContractHook();

      let value: unknown;
      await act(async () => {
        value = await result.current.callFunction("list", []);
      });

      expect(value).toEqual([1, 2]);
    });

    it("returns null when the simulation carries no return value", async () => {
      mockSimulateTransaction.mockResolvedValue({
        id: "sim-1",
        latestLedger: 100,
      });

      const { result } = renderContractHook();

      let value: unknown;
      await act(async () => {
        value = await result.current.callFunction("noop", []);
      });

      expect(value).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it("encodes arguments into the simulated transaction", async () => {
      mockSimulateTransaction.mockResolvedValue(
        simulationSuccess(xdr.ScVal.scvBool(true)),
      );

      const { result } = renderContractHook();

      await act(async () => {
        await result.current.callFunction("transfer", [
          // toXdrValue accepts an Address instance at runtime, but the
          // exported TypedArg union does not name it.
          new Address(ACCOUNT_ADDRESS) as never,
          { value: 250, type: "u64" },
          "memo",
        ]);
      });

      // The hook hands soroban-rpc a real Transaction; read the invocation
      // back out of it to confirm the arguments survived encoding.
      const submitted = mockSimulateTransaction.mock.calls[0][0] as {
        operations: Array<{ func: HostFunction }>;
      };
      const invocation = submitted.operations[0].func.invokeContract();

      expect(
        StrKey.encodeContract(invocation.contractAddress().contractId()),
      ).toBe(CONTRACT_ID);
      expect(invocation.functionName().toString()).toBe("transfer");

      const args = invocation.args();
      expect(args).toHaveLength(3);
      expect(Address.fromScVal(args[0]).toString()).toBe(ACCOUNT_ADDRESS);
      expect(args[1].u64().toString()).toBe("250");
      expect(args[2].str().toString()).toBe("memo");
    });

    it("builds an unsigned invocation XDR without touching the network", async () => {
      const { result } = renderContractHook();

      let xdrString = "";
      await act(async () => {
        xdrString = await result.current.buildInvokeXDR("increment", []);
      });

      expect(typeof xdrString).toBe("string");
      expect(xdrString.length).toBeGreaterThan(0);

      // The XDR must round-trip through the real parser.
      const tx = TransactionBuilder.fromXDR(xdrString, Networks.TESTNET);
      expect(tx.signatures).toHaveLength(0);
      expect(mockSimulateTransaction).not.toHaveBeenCalled();
      expect(result.current.error).toBeNull();
    });

    it("signs and submits an invocation", async () => {
      const { result } = renderContractHook();

      let xdrString = "";
      await act(async () => {
        xdrString = await result.current.buildInvokeXDR("increment", []);
      });

      mockSendTransaction.mockResolvedValue({
        status: "PENDING",
        hash: "soroban_tx_hash",
      });

      let response: unknown;
      await act(async () => {
        response = await result.current.submitInvokeWithSecret(
          xdrString,
          SIGNER_KP.secret(),
        );
      });

      expect(response).toMatchObject({ status: "PENDING" });

      const sent = mockSendTransaction.mock.calls[0][0] as {
        signatures: unknown[];
      };
      expect(sent.signatures.length).toBeGreaterThan(0);
      expect(result.current.error).toBeNull();
    });

    it("uses the configured RPC URL", () => {
      const sorobanRpc = "https://soroban.example.test";
      renderContractHook({ sorobanRpc });

      expect(mockRpcServerConstructor).toHaveBeenCalledWith(sorobanRpc);
    });

    it("targets the contract it was configured with", async () => {
      mockSimulateTransaction.mockResolvedValue(
        simulationSuccess(xdr.ScVal.scvVoid()),
      );

      const { result } = renderContractHook({ contractId: OTHER_CONTRACT_ID });
      await act(async () => {
        await result.current.callFunction("ping", []);
      });

      const submitted = mockSimulateTransaction.mock.calls[0][0] as {
        operations: Array<{ func: HostFunction }>;
      };
      expect(
        StrKey.encodeContract(
          submitted.operations[0].func
            .invokeContract()
            .contractAddress()
            .contractId(),
        ),
      ).toBe(OTHER_CONTRACT_ID);
    });
  });

  // ── Simulation error path ─────────────────────────────────────────────────

  describe("a simulation error", () => {
    it("rejects and exposes the host error on the hook", async () => {
      mockSimulateTransaction.mockResolvedValue(
        simulationFailure("HostError: Error(Contract, #3)"),
      );

      const { result } = renderContractHook();

      // A failed simulation rejects — unlike a payment submission, the caller
      // gets an exception rather than a result object.
      const rejection = await expectRejection(() =>
        result.current.callFunction("withdraw", []),
      );
      expect(rejection.message).toMatch(/Simulation failed/i);

      expect(result.current.error).toBeInstanceOf(Error);
      // The underlying host error must reach the caller, not a generic message.
      expect(result.current.error?.message).toContain(
        "HostError: Error(Contract, #3)",
      );
      expect(result.current.loading).toBe(false);
    });

    it("surfaces an RPC transport failure", async () => {
      mockSimulateTransaction.mockRejectedValue(new Error("rpc unreachable"));

      const { result } = renderContractHook();

      const rejection = await expectRejection(() =>
        result.current.callFunction("get_count", []),
      );
      expect(rejection.message).toMatch(/rpc unreachable/i);

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toMatch(/rpc unreachable/i);
    });

    it("clears a previous error once a later call succeeds", async () => {
      mockSimulateTransaction.mockResolvedValueOnce(simulationFailure());

      const { result } = renderContractHook();

      await expectRejection(() => result.current.callFunction("withdraw", []));
      expect(result.current.error).not.toBeNull();

      mockSimulateTransaction.mockResolvedValue(
        simulationSuccess(xdr.ScVal.scvU32(1)),
      );

      let value: unknown;
      await act(async () => {
        value = await result.current.callFunction("get_count", []);
      });

      expect(value).toBe(1);
      expect(result.current.error).toBeNull();
    });

    it("reports a submission failure through submitInvokeWithSecret", async () => {
      const { result } = renderContractHook();

      let xdrString = "";
      await act(async () => {
        xdrString = await result.current.buildInvokeXDR("increment", []);
      });

      mockSendTransaction.mockRejectedValue(new Error("tx rejected"));

      const rejection = await expectRejection(() =>
        result.current.submitInvokeWithSecret(xdrString, SIGNER_KP.secret()),
      );
      expect(rejection.message).toMatch(/tx rejected/i);

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.loading).toBe(false);
    });

    it("rejects a malformed secret before reaching the network", async () => {
      const { result } = renderContractHook();

      let xdrString = "";
      await act(async () => {
        xdrString = await result.current.buildInvokeXDR("increment", []);
      });

      await expectRejection(() =>
        result.current.submitInvokeWithSecret(xdrString, "not-a-secret"),
      );

      expect(mockSendTransaction).not.toHaveBeenCalled();
    });
  });
});
