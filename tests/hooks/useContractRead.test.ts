/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import {
  act,
  renderHook,
  SOROBAN_TESTNET_RPC as SOROBAN_RPC_URL,
  VALID_CONTRACT_ID,
  waitFor,
} from "../helpers";
import * as StellarSDK from "@stellar/stellar-sdk";
import {
  useContractRead,
  clearContractReadCache,
  invalidateContractReadCache,
} from "../../src/templates/default/src/hooks/useContractRead.ts";

const SDK = ((StellarSDK as unknown as { default?: unknown }).default ||
  StellarSDK) as typeof StellarSDK;
const { xdr, rpc, Networks } = SDK;

const SECOND_CONTRACT_ID =
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

describe("useContractRead", () => {
  beforeEach(() => {
    clearContractReadCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    clearContractReadCache();
  });

  it("simulates a read-only contract call and returns decoded data", async () => {
    const simSpy = jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValue({
        result: {
          retval: xdr.ScVal.scvString("hello-soroban"),
        },
      } as never);

    const { result } = renderHook(() =>
      useContractRead<string>({
        contractId: VALID_CONTRACT_ID,
        method: "greet",
        args: ["world"],
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBe("hello-soroban");
    expect(result.current.error).toBeNull();
    expect(result.current.isValidating).toBe(false);
    expect(result.current.isStale).toBe(false);
    expect(simSpy).toHaveBeenCalledTimes(1);

    // Verify default TESTNET network passphrase was used on the built transaction
    const builtTx = simSpy.mock.calls[0][0] as { networkPassphrase: string };
    expect(builtTx.networkPassphrase).toBe(Networks.TESTNET);
  });

  it("uses PUBLIC network passphrase when network is set to PUBLIC", async () => {
    const simSpy = jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValue({
        result: {
          retval: xdr.ScVal.scvU32(42),
        },
      } as never);

    const { result } = renderHook(() =>
      useContractRead<number>({
        contractId: VALID_CONTRACT_ID,
        method: "get_count",
        network: "PUBLIC",
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBe(42);
    const builtTx = simSpy.mock.calls[0][0] as { networkPassphrase: string };
    expect(builtTx.networkPassphrase).toBe(Networks.PUBLIC);
  });

  it("caches simulation results by contract + method + args", async () => {
    const simSpy = jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvI32(100) },
      } as never)
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvI32(200) },
      } as never)
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvI32(300) },
      } as never);

    // First mount populates cache
    const first = renderHook(() =>
      useContractRead<number>({
        contractId: VALID_CONTRACT_ID,
        method: "balance",
        args: [1],
        sorobanRpc: SOROBAN_RPC_URL,
        staleTime: 60_000,
      }),
    );

    await waitFor(() => expect(first.result.current.data).toBe(100));
    expect(simSpy).toHaveBeenCalledTimes(1);

    // Second mount with identical contract + method + args hits cache without RPC call
    const second = renderHook(() =>
      useContractRead<number>({
        contractId: VALID_CONTRACT_ID,
        method: "balance",
        args: [1],
        sorobanRpc: SOROBAN_RPC_URL,
        staleTime: 60_000,
      }),
    );

    expect(second.result.current.data).toBe(100);
    expect(second.result.current.loading).toBe(false);
    expect(simSpy).toHaveBeenCalledTimes(1);

    // Different args trigger a new simulation
    const diffArgs = renderHook(() =>
      useContractRead<number>({
        contractId: VALID_CONTRACT_ID,
        method: "balance",
        args: [2],
        sorobanRpc: SOROBAN_RPC_URL,
        staleTime: 60_000,
      }),
    );

    await waitFor(() => expect(diffArgs.result.current.data).toBe(200));
    expect(simSpy).toHaveBeenCalledTimes(2);

    // Different method triggers a new simulation
    const diffMethod = renderHook(() =>
      useContractRead<number>({
        contractId: VALID_CONTRACT_ID,
        method: "total_supply",
        args: [1],
        sorobanRpc: SOROBAN_RPC_URL,
        staleTime: 60_000,
      }),
    );

    await waitFor(() => expect(diffMethod.result.current.data).toBe(300));
    expect(simSpy).toHaveBeenCalledTimes(3);
  });

  it("serves stale cached data immediately while revalidating in the background (SWR)", async () => {
    let resolveSecond!: (value: unknown) => void;
    const secondPromise = new Promise((resolve) => {
      resolveSecond = resolve;
    });

    const simSpy = jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvString("v1") },
      } as never)
      .mockReturnValueOnce(secondPromise as never);

    // Populate cache with staleTime: 0 so subsequent mounts treat it as stale
    const first = renderHook(() =>
      useContractRead<string>({
        contractId: VALID_CONTRACT_ID,
        method: "version",
        sorobanRpc: SOROBAN_RPC_URL,
        staleTime: 0,
      }),
    );

    await waitFor(() => expect(first.result.current.data).toBe("v1"));
    first.unmount();

    // Second mount should immediately see "v1" (loading: false) while revalidating
    const second = renderHook(() =>
      useContractRead<string>({
        contractId: VALID_CONTRACT_ID,
        method: "version",
        sorobanRpc: SOROBAN_RPC_URL,
        staleTime: 0,
      }),
    );

    expect(second.result.current.data).toBe("v1");
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.isValidating).toBe(true);
    expect(simSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSecond({
        result: { retval: xdr.ScVal.scvString("v2") },
      });
    });

    await waitFor(() => {
      expect(second.result.current.data).toBe("v2");
      expect(second.result.current.isValidating).toBe(false);
      expect(second.result.current.isStale).toBe(false);
    });
  });

  it("supports manual invalidation via hook invalidate() and invalidateContractReadCache()", async () => {
    const simSpy = jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvI32(1) },
      } as never)
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvI32(2) },
      } as never)
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvI32(3) },
      } as never);

    const { result } = renderHook(() =>
      useContractRead<number>({
        contractId: VALID_CONTRACT_ID,
        method: "counter",
        sorobanRpc: SOROBAN_RPC_URL,
        staleTime: 60_000,
      }),
    );

    await waitFor(() => expect(result.current.data).toBe(1));
    expect(simSpy).toHaveBeenCalledTimes(1);

    // Hook-level invalidate() evicts cache and re-simulates
    await act(async () => {
      await result.current.invalidate();
    });

    expect(result.current.data).toBe(2);
    expect(simSpy).toHaveBeenCalledTimes(2);

    // Module-level invalidateContractReadCache(contractId) triggers revalidation
    act(() => {
      invalidateContractReadCache(VALID_CONTRACT_ID);
    });

    await waitFor(() => expect(result.current.data).toBe(3));
    expect(simSpy).toHaveBeenCalledTimes(3);

    // Invalidating an unrelated contract ID does not trigger a refetch
    act(() => {
      invalidateContractReadCache(SECOND_CONTRACT_ID);
    });

    expect(simSpy).toHaveBeenCalledTimes(3);
  });

  it("refetches on the configured refetchInterval", async () => {
    jest.useFakeTimers();

    const simSpy = jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvI32(10) },
      } as never)
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvI32(11) },
      } as never)
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvI32(12) },
      } as never);

    const { result, unmount } = renderHook(() =>
      useContractRead<number>({
        contractId: VALID_CONTRACT_ID,
        method: "price",
        sorobanRpc: SOROBAN_RPC_URL,
        refetchInterval: 5_000,
      }),
    );

    await waitFor(() => expect(result.current.data).toBe(10));
    expect(simSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    await waitFor(() => expect(result.current.data).toBe(11));
    expect(simSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    await waitFor(() => expect(result.current.data).toBe(12));
    expect(simSpy).toHaveBeenCalledTimes(3);

    // Unmounting clears the interval
    unmount();
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(simSpy).toHaveBeenCalledTimes(3);
  });

  it("handles Soroban RPC simulation error responses (failure mode 1)", async () => {
    jest.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValue({
      error: "HostError: Error(Contract, #1)",
    } as never);

    const { result } = renderHook(() =>
      useContractRead({
        contractId: VALID_CONTRACT_ID,
        method: "failing_method",
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toContain(
      "Simulation error: HostError: Error(Contract, #1)",
    );
  });

  it("handles network/RPC rejection errors (failure mode 2)", async () => {
    jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockRejectedValue(new Error("RPC endpoint unreachable"));

    const { result } = renderHook(() =>
      useContractRead({
        contractId: VALID_CONTRACT_ID,
        method: "get_state",
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("RPC endpoint unreachable");
  });

  it("sets error without calling RPC when contractId is invalid (failure mode 3)", async () => {
    const simSpy = jest.spyOn(rpc.Server.prototype, "simulateTransaction");

    const { result } = renderHook(() =>
      useContractRead({
        contractId: "INVALID_CONTRACT_ID",
        method: "greet",
        sorobanRpc: SOROBAN_RPC_URL,
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(simSpy).not.toHaveBeenCalled();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toContain(
      "Invalid Soroban contract ID",
    );
  });

  it("skips simulation when enabled is false", async () => {
    const simSpy = jest.spyOn(rpc.Server.prototype, "simulateTransaction");

    const { result } = renderHook(() =>
      useContractRead({
        contractId: VALID_CONTRACT_ID,
        method: "greet",
        sorobanRpc: SOROBAN_RPC_URL,
        enabled: false,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(simSpy).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
  });
});
