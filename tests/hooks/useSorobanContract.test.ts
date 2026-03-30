/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import * as StellarSDK from "@stellar/stellar-sdk";
import { useSorobanContract } from "../../src/templates/js-template/src/hooks/useSorobanContract.js";

const SDK = ((StellarSDK as unknown as { default?: unknown }).default ||
  StellarSDK) as typeof StellarSDK;
const { xdr, Address, Contract, rpc } = SDK;

const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const VALID_CONTRACT_ID = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";
const VALID_ACCOUNT_ADDRESS = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

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
      { status: 400 }
    );
  })
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
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
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
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
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
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
    );

    await act(async () => {
      await result.current.callFunction("set_owner", [Address.fromString(VALID_ACCOUNT_ADDRESS)]);
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
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
    );

    await act(async () => {
      await result.current.callFunction("set_complex", [[1, 2, 3], { foo: "bar", count: 2 }]);
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
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
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
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
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
        val: xdr.ScVal.scvVec([xdr.ScVal.scvI32(1), xdr.ScVal.scvI32(2), xdr.ScVal.scvI32(3)]),
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
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
    );

    let output: unknown;
    await act(async () => {
      output = await result.current.callFunction("get_complex", []);
    });

    expect(output).toEqual({ items: [1, 2, 3], enabled: true });
  });

  it("buildInvokeXDR returns a non-empty base64 string", async () => {
    const { result } = renderHook(() =>
      useSorobanContract({ contractId: VALID_CONTRACT_ID, sorobanRpc: SOROBAN_RPC_URL })
    );

    let txXdr = "";
    await act(async () => {
      txXdr = await result.current.buildInvokeXDR("ping", ["value"]);
    });

    expect(txXdr).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("invalid contract ID is surfaced", async () => {
    const { result } = renderHook(() =>
      useSorobanContract({ contractId: "invalid-contract-id", sorobanRpc: SOROBAN_RPC_URL })
    );

    let thrown: Error | undefined;
    await act(async () => {
      try {
        await result.current.buildInvokeXDR("ping", []);
      } catch (error) {
        thrown = error as Error;
      }
    });

    expect(thrown).toBeDefined();
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  });

  it("network failure is surfaced through MSW", async () => {
    server.use(
      http.post(SOROBAN_RPC_URL, async () => HttpResponse.json({ error: "boom" }, { status: 500 }))
    );

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
      })
    );

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
});
