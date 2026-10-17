/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import {
  act,
  renderHook,
  SOROBAN_TESTNET_RPC as SOROBAN_RPC_URL,
  USDC_ISSUER as VALID_ACCOUNT_ADDRESS,
  VALID_CONTRACT_ID,
  waitFor,
} from "../helpers";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import * as StellarSDK from "@stellar/stellar-sdk";
import { useSorobanContract } from "../../src/templates/default/src/hooks/useSorobanContract.ts";

const SDK = ((StellarSDK as unknown as { default?: unknown }).default ||
  StellarSDK) as typeof StellarSDK;
const { xdr, Address, Contract, rpc, Account, TransactionBuilder } = SDK;

const server = setupServer(
  http.post(SOROBAN_RPC_URL, async ({ request }) => {
    const body = (await request.json()) as { id?: number; method?: string };

    if (body.method === "simulateTransaction") {
      return HttpResponse.json({
        jsonrpc: "2.0",
        id: body.id ?? 1,
        result: {
          latestLedger: 123,
          minResourceFee: "100",
          transactionData: "AAAAAQAAAAA=",
          results: [],
          result: {
            auth: [],
            retval: xdr.ScVal.scvString("ok").toXDR("base64"),
          },
        },
      });
    }

    if (body.method === "sendTransaction") {
      return HttpResponse.json({
        jsonrpc: "2.0",
        id: body.id ?? 1,
        result: { status: "PENDING", hash: "mock-hash" },
      });
    }

    return HttpResponse.json(
      {
        jsonrpc: "2.0",
        id: body.id ?? 1,
        error: { code: -32601, message: "Unsupported RPC method" },
      },
      { status: 400 },
    );
  }),
);

describe("useSorobanContract", () => {
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

  afterEach(() => {
    server.resetHandlers();
    jest.restoreAllMocks();
  });

  afterAll(() => server.close());

  it("invokeContract read-only flow returns parsed result", async () => {
    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      result: {
        retval: xdr.ScVal.scvString("hello"),
      },
    } as never);

    const { result } = renderHook(() =>
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    let output: unknown;
    await act(async () => {
      output = await result.current.callFunction("greet", []);
    });

    expect(output).toBe("hello");
  });

  it("toXdrValue converts string/number/boolean", async () => {
    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      result: { retval: xdr.ScVal.scvBool(true) },
    } as never);

    const callSpy = jest.spyOn(Contract.prototype, "call");

    const { result } = renderHook(() =>
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    await act(async () => {
      await result.current.callFunction("set_primitives", ["hello", 42, true]);
    });

    const call = callSpy.mock.calls[0];
    expect((call[1] as xdr.ScVal).str().toString()).toBe("hello");
    expect((call[2] as xdr.ScVal).i32()).toBe(42);
    expect((call[3] as xdr.ScVal).b()).toBe(true);
  });

  it("toXdrValue converts address", async () => {
    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      result: { retval: xdr.ScVal.scvBool(true) },
    } as never);

    const callSpy = jest.spyOn(Contract.prototype, "call");

    const { result } = renderHook(() =>
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    await act(async () => {
      await result.current.callFunction("set_owner", [
        Address.fromString(VALID_ACCOUNT_ADDRESS),
      ]);
    });

    const call = callSpy.mock.calls[0];
    expect((call[1] as xdr.ScVal).switch().name).toBe("scvAddress");
  });

  it("toXdrValue converts array/object", async () => {
    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      result: { retval: xdr.ScVal.scvBool(true) },
    } as never);

    const callSpy = jest.spyOn(Contract.prototype, "call");

    const { result } = renderHook(() =>
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    await act(async () => {
      await result.current.callFunction("set_complex", [
        [1, 2, 3],
        { foo: "bar", count: 2 },
      ]);
    });

    const call = callSpy.mock.calls[0];
    expect((call[1] as xdr.ScVal).switch().name).toBe("scvVec");
    expect((call[2] as xdr.ScVal).switch().name).toBe("scvMap");
  });

  it("fromXdrValue converts i32", async () => {
    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      result: {
        retval: xdr.ScVal.scvI32(7),
      },
    } as never);

    const { result } = renderHook(() =>
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    let output: unknown;
    await act(async () => {
      output = await result.current.callFunction("get_count", []);
    });

    expect(output).toBe(7);
  });

  it("fromXdrValue converts bool", async () => {
    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      result: {
        retval: xdr.ScVal.scvBool(false),
      },
    } as never);

    const { result } = renderHook(() =>
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    let output: unknown;
    await act(async () => {
      output = await result.current.callFunction("is_paused", []);
    });

    expect(output).toBe(false);
  });

  it("fromXdrValue converts vec/map", async () => {
    const complex = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvString("items"),
        val: xdr.ScVal.scvVec([
          xdr.ScVal.scvI32(1),
          xdr.ScVal.scvI32(2),
          xdr.ScVal.scvI32(3),
        ]),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvString("enabled"),
        val: xdr.ScVal.scvBool(true),
      }),
    ]);

    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      result: {
        retval: complex,
      },
    } as never);

    const { result } = renderHook(() =>
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    let output: unknown;
    await act(async () => {
      output = await result.current.callFunction("get_complex", []);
    });

    expect(output).toEqual({ items: [1, 2, 3], enabled: true });
  });

  it("buildInvokeXDR returns a non-empty base64 string", async () => {
    const { result } = renderHook(() =>
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    let txXdr = "";
    await act(async () => {
      txXdr = await result.current.buildInvokeXDR("ping", ["value"]);
    });

    expect(txXdr).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("invalid contract ID is surfaced", () => {
    expect(() =>
      renderHook(() =>
        useSorobanContract({
          contractId: "invalid-contract-id",
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      ),
    ).toThrow(/Invalid Soroban contract ID/);
  });

  it("network failure is surfaced through MSW", async () => {
    server.use(
      http.post(SOROBAN_RPC_URL, async () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() =>
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    let thrown: Error | undefined;
    await act(async () => {
      try {
        await result.current.callFunction("will_fail", []);
      } catch (error) {
        thrown = error as Error;
      }
    });

    expect(thrown?.message).toContain("status code 500");
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  });

  it("simulation failure payload is surfaced", async () => {
    server.use(
      http.post(SOROBAN_RPC_URL, async ({ request }) => {
        const body = (await request.json()) as { id?: number };

        return HttpResponse.json({
          jsonrpc: "2.0",
          id: body.id ?? 1,
          error: {
            code: -32000,
            message: "simulated host function failure",
          },
        });
      }),
    );

    const { result } = renderHook(() =>
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
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

  it("handles restore footprint flow when simulation returns restorePreamble", async () => {
    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      restorePreamble: {
        minResourceFee: "500",
        transactionData: "AAAAAQAAAA==",
      },
      transactionData: "AAAAAQAAAA==",
    } as never);

    const { result } = renderHook(() =>
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    let res: any;
    await act(async () => {
      res = await result.current.callFunction("expired_entry", []);
    });

    expect(res).toEqual(
      expect.objectContaining({
        requiresRestore: true,
        restorePreamble: expect.objectContaining({ minResourceFee: "500" }),
      }),
    );
    expect(result.current.error?.message).toContain("Footprint expired");
  });

  // ── simulateContractCall (#968) ─────────────────────────────────────────────

  it("simulateContractCall returns decoded result and fee info", async () => {
    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      result: { retval: xdr.ScVal.scvString("preview-ok") },
      minResourceFee: "500",
      latestLedger: 9999,
    } as never);

    const { result } = renderHook(() =>
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    let preview:
      | { result: unknown; minResourceFee: string; latestLedger: number }
      | undefined;
    await act(async () => {
      preview = await result.current.simulateContractCall("get_value", []);
    });

    expect(preview).toBeDefined();
    expect(preview!.result).toBe("preview-ok");
    expect(preview!.minResourceFee).toBe("500");
    expect(preview!.latestLedger).toBe(9999);
  });

  it("simulateContractCall includes the classic base fee (#1063)", async () => {
    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      result: { retval: xdr.ScVal.scvString("preview-ok") },
      minResourceFee: "500",
      latestLedger: 9999,
    } as never);

    const { result } = renderHook(() =>
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    let preview: { baseFee: string } | undefined;
    await act(async () => {
      preview = await result.current.simulateContractCall("get_value", []);
    });

    // BASE_FEE from the SDK is "100" stroops.
    expect(preview!.baseFee).toBe(SDK.BASE_FEE);
    expect(preview!.baseFee).toBe("100");
  });

  it("simulateContractCall returns null result when retval absent", async () => {
    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      minResourceFee: "200",
      latestLedger: 1234,
    } as never);

    const { result } = renderHook(() =>
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    let preview:
      | { result: unknown; minResourceFee: string; latestLedger: number }
      | undefined;
    await act(async () => {
      preview = await result.current.simulateContractCall("no_return", []);
    });

    expect(preview!.result).toBeNull();
    expect(preview!.minResourceFee).toBe("200");
    expect(preview!.latestLedger).toBe(1234);
  });

  it("simulateContractCall surfaces simulation error and sets error state", async () => {
    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      error: "contract reverted with panic",
    } as never);

    const { result } = renderHook(() =>
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
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
    jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockReturnValue(pending as never);

    const { result } = renderHook(() =>
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    let callPromise!: Promise<unknown>;
    act(() => {
      callPromise = result.current.simulateContractCall("slow_fn", []);
    });

    await waitFor(() => expect(result.current.loading).toBe(true));

    resolveSimulation({
      result: { retval: xdr.ScVal.scvBool(true) },
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
      useSorobanContract({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    expect(typeof result.current.simulateContractCall).toBe("function");
  });

  // ── simulateBatchContractCall / buildBatchInvokeXDRs (#1062) ────────────────
  //
  // Soroban caps a transaction containing a host-function invocation at
  // exactly one operation (stellar-core's validateSorobanOpsConsistency
  // rejects anything else as txMALFORMED), so "batch" here means several
  // independent single-operation calls run/built together — not one
  // multi-operation transaction. See the hook's JSDoc for the full rationale.

  describe("simulateBatchContractCall", () => {
    it("simulates each call independently and returns results in order", async () => {
      const spy = jest.spyOn(rpc.Server.prototype, "simulateTransaction");
      spy
        .mockResolvedValueOnce({
          result: { retval: xdr.ScVal.scvI32(1) },
          minResourceFee: "100",
          latestLedger: 10,
        } as never)
        .mockResolvedValueOnce({
          result: { retval: xdr.ScVal.scvI32(2) },
          minResourceFee: "150",
          latestLedger: 11,
        } as never);

      const { result } = renderHook(() =>
        useSorobanContract({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      let results: Array<{
        result: unknown;
        minResourceFee: string;
        latestLedger: number;
      }> = [];
      await act(async () => {
        results = await result.current.simulateBatchContractCall([
          { name: "get_a", args: [] },
          { name: "get_b", args: [] },
        ]);
      });

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        result: 1,
        minResourceFee: "100",
        latestLedger: 10,
      });
      expect(results[1]).toEqual({
        result: 2,
        minResourceFee: "150",
        latestLedger: 11,
      });
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it("calls each function with its own args against the same contract", async () => {
      jest
        .spyOn(rpc.Server.prototype, "simulateTransaction")
        .mockResolvedValue({
          result: { retval: xdr.ScVal.scvBool(true) },
          minResourceFee: "100",
          latestLedger: 1,
        } as never);
      const callSpy = jest.spyOn(Contract.prototype, "call");

      const { result } = renderHook(() =>
        useSorobanContract({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      await act(async () => {
        await result.current.simulateBatchContractCall([
          { name: "balance", args: ["addr-a"] },
          { name: "balance", args: ["addr-b"] },
        ]);
      });

      expect(callSpy).toHaveBeenCalledTimes(2);
      expect(callSpy.mock.calls[0][0]).toBe("balance");
      expect(callSpy.mock.calls[1][0]).toBe("balance");
    });

    it("rejects the whole batch when one call's simulation fails", async () => {
      const spy = jest.spyOn(rpc.Server.prototype, "simulateTransaction");
      spy
        .mockResolvedValueOnce({
          result: { retval: xdr.ScVal.scvI32(1) },
          minResourceFee: "100",
          latestLedger: 10,
        } as never)
        .mockResolvedValueOnce({
          error: "second call reverted",
        } as never);

      const { result } = renderHook(() =>
        useSorobanContract({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      let thrown: Error | undefined;
      await act(async () => {
        try {
          await result.current.simulateBatchContractCall([
            { name: "ok_fn", args: [] },
            { name: "bad_fn", args: [] },
          ]);
        } catch (err) {
          thrown = err as Error;
        }
      });

      expect(thrown?.message).toContain("bad_fn");
      expect(thrown?.message).toContain("second call reverted");
    });

    it("throws synchronously-rejected promise when calls is empty", async () => {
      const { result } = renderHook(() =>
        useSorobanContract({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      await expect(
        result.current.simulateBatchContractCall([]),
      ).rejects.toThrow(/at least one call/i);
    });
  });

  describe("buildBatchInvokeXDRs", () => {
    it("builds one XDR per call with consecutive sequence numbers", async () => {
      jest
        .spyOn(rpc.Server.prototype, "getAccount")
        .mockResolvedValue(new Account(VALID_ACCOUNT_ADDRESS, "100") as never);

      const { result } = renderHook(() =>
        useSorobanContract({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      let xdrs: string[] = [];
      await act(async () => {
        xdrs = await result.current.buildBatchInvokeXDRs(
          [
            { name: "transfer", args: ["addr-a", 100] },
            { name: "transfer", args: ["addr-b", 200] },
          ],
          VALID_ACCOUNT_ADDRESS,
        );
      });

      expect(xdrs).toHaveLength(2);

      const tx1 = TransactionBuilder.fromXDR(xdrs[0], SDK.Networks.TESTNET);
      const tx2 = TransactionBuilder.fromXDR(xdrs[1], SDK.Networks.TESTNET);
      expect(tx1.sequence).toBe("101");
      expect(tx2.sequence).toBe("102");
    });

    it("throws when calls is empty", async () => {
      jest
        .spyOn(rpc.Server.prototype, "getAccount")
        .mockResolvedValue(new Account(VALID_ACCOUNT_ADDRESS, "100") as never);

      const { result } = renderHook(() =>
        useSorobanContract({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      await expect(
        result.current.buildBatchInvokeXDRs([], VALID_ACCOUNT_ADDRESS),
      ).rejects.toThrow(/at least one call/i);
    });

    it("propagates the error when the source account can't be loaded", async () => {
      jest
        .spyOn(rpc.Server.prototype, "getAccount")
        .mockRejectedValue(new Error("account not found"));

      const { result } = renderHook(() =>
        useSorobanContract({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      let thrown: Error | undefined;
      await act(async () => {
        try {
          await result.current.buildBatchInvokeXDRs(
            [{ name: "ping", args: [] }],
            VALID_ACCOUNT_ADDRESS,
          );
        } catch (err) {
          thrown = err as Error;
        }
      });

      expect(thrown?.message).toContain("account not found");
    });
  });
});
