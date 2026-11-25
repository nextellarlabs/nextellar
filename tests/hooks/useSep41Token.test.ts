/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import * as StellarSDK from "@stellar/stellar-sdk";
import { act, renderHook } from "@testing-library/react";
import {
  formatSep41Amount,
  parseSep41Amount,
  useSep41Token,
} from "../../src/templates/default/src/hooks/useSep41Token.ts";

const SOROBAN_TESTNET_RPC = "https://soroban-testnet.stellar.org";
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const PAYMENT_DESTINATION =
  "GDQJUTQYK2MQX2VGDR2FYWLIYAQIEGXTQVTFEMGH2BEWFG4BRUY4XBKT";
const VALID_CONTRACT_ID =
  "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";

const SDK = ((StellarSDK as unknown as { default?: unknown }).default ||
  StellarSDK) as typeof StellarSDK;
const { xdr, rpc, Contract, Account } = SDK;
type ScVal = ReturnType<typeof xdr.ScVal.scvVoid>;

function i128ScVal(value: bigint): ScVal {
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: xdr.Int64.fromString("0"),
      lo: xdr.Uint64.fromString(value.toString()),
    }),
  );
}

describe("useSep41Token", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("converts token amounts without floating-point rounding", () => {
    expect(parseSep41Amount("12.34", 7)).toBe(123_400_000n);
    expect(formatSep41Amount(123_400_000n, 7)).toBe("12.34");
    expect(parseSep41Amount("12", 0)).toBe(12n);
  });

  it("reads and formats i128 balances using the token's decimals", async () => {
    jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvU32(7) },
      } as never)
      .mockResolvedValueOnce({
        result: { retval: i128ScVal(123_400_000n) },
      } as never);

    const { result } = renderHook(() =>
      useSep41Token({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_TESTNET_RPC,
      }),
    );

    let balance: Awaited<ReturnType<typeof result.current.getBalance>>;
    await act(async () => {
      balance = await result.current.getBalance(USDC_ISSUER);
    });

    expect(balance!).toEqual({
      raw: 123_400_000n,
      formatted: "12.34",
      decimals: 7,
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("reads and formats an allowance", async () => {
    jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvU32(2) },
      } as never)
      .mockResolvedValueOnce({
        result: { retval: i128ScVal(125n) },
      } as never);

    const { result } = renderHook(() =>
      useSep41Token({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_TESTNET_RPC,
      }),
    );

    let allowance: Awaited<ReturnType<typeof result.current.getAllowance>>;
    await act(async () => {
      allowance = await result.current.getAllowance(
        USDC_ISSUER,
        PAYMENT_DESTINATION,
      );
    });

    expect(allowance!).toEqual({
      raw: 125n,
      formatted: "1.25",
      decimals: 2,
    });
  });

  it("builds a transfer using the sender as the transaction source", async () => {
    jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvU32(2) },
      } as never);
    const getAccount = jest
      .spyOn(rpc.Server.prototype, "getAccount")
      .mockResolvedValue(new Account(USDC_ISSUER, "5"));
    const contractCall = jest.spyOn(Contract.prototype, "call");

    const { result } = renderHook(() =>
      useSep41Token({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_TESTNET_RPC,
      }),
    );

    await act(async () => {
      await result.current.buildTransferXDR({
        from: USDC_ISSUER,
        to: PAYMENT_DESTINATION,
        amount: "1.25",
      });
    });

    expect(getAccount).toHaveBeenCalledWith(USDC_ISSUER);
    expect(contractCall.mock.calls[1]?.[0]).toBe("transfer");
    expect(
      (contractCall.mock.calls[1]?.[3] as ScVal).i128().lo().toString(),
    ).toBe("125");
  });

  it("builds approve calls with raw i128 amount and u32 ledger expiry", async () => {
    jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvU32(2) },
      } as never);
    jest
      .spyOn(rpc.Server.prototype, "getAccount")
      .mockResolvedValue(new Account(USDC_ISSUER, "5"));
    const contractCall = jest.spyOn(Contract.prototype, "call");

    const { result } = renderHook(() =>
      useSep41Token({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_TESTNET_RPC,
      }),
    );

    let xdrResult: string;
    await act(async () => {
      xdrResult = await result.current.buildApproveXDR({
        from: USDC_ISSUER,
        spender: PAYMENT_DESTINATION,
        amount: "1.25",
        liveUntilLedger: 1234,
      });
    });

    expect(xdrResult!).toEqual(expect.any(String));
    const [method, from, spender, amount, expiration] = contractCall.mock
      .calls[1] as unknown as [string, ...ScVal[]];
    expect(method).toBe("approve");
    expect(from.switch().name).toBe("scvAddress");
    expect(spender.switch().name).toBe("scvAddress");
    expect(amount.switch().name).toBe("scvI128");
    expect(expiration.u32()).toBe(1234);
    expect(result.current.error).toBeNull();
  });

  it("builds transfer_from with the spender as the transaction source", async () => {
    jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvU32(2) },
      } as never);
    const getAccount = jest
      .spyOn(rpc.Server.prototype, "getAccount")
      .mockResolvedValue(new Account(PAYMENT_DESTINATION, "5"));
    const contractCall = jest.spyOn(Contract.prototype, "call");

    const { result } = renderHook(() =>
      useSep41Token({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_TESTNET_RPC,
      }),
    );

    await act(async () => {
      await result.current.buildTransferFromXDR({
        spender: PAYMENT_DESTINATION,
        from: USDC_ISSUER,
        to: USDC_ISSUER,
        amount: "1.25",
      });
    });

    expect(getAccount).toHaveBeenCalledWith(PAYMENT_DESTINATION);
    expect(contractCall.mock.calls[1]?.[0]).toBe("transfer_from");
  });

  it("surfaces RPC failures through error and rethrows them", async () => {
    jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockRejectedValue(new Error("RPC unavailable"));

    const { result } = renderHook(() =>
      useSep41Token({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_TESTNET_RPC,
      }),
    );

    await act(async () => {
      await expect(result.current.getDecimals()).rejects.toThrow(
        "RPC unavailable",
      );
    });

    expect(result.current.error?.message).toContain("RPC unavailable");
    expect(result.current.loading).toBe(false);
  });

  it("rejects unsupported token precision and excessive decimal input", async () => {
    jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvU32(39) },
      } as never);

    const { result } = renderHook(() =>
      useSep41Token({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_TESTNET_RPC,
      }),
    );

    await act(async () => {
      await expect(result.current.getDecimals()).rejects.toThrow(
        "Unsupported token decimals",
      );
    });
    expect(result.current.error?.message).toContain(
      "Unsupported token decimals",
    );
    expect(() => parseSep41Amount("1.234", 2)).toThrow(
      "more than 2 significant decimal places",
    );
  });

  it("rejects an amount with excess precision before building a transaction", async () => {
    jest
      .spyOn(rpc.Server.prototype, "simulateTransaction")
      .mockResolvedValueOnce({
        result: { retval: xdr.ScVal.scvU32(2) },
      } as never);
    const getAccount = jest.spyOn(rpc.Server.prototype, "getAccount");

    const { result } = renderHook(() =>
      useSep41Token({
        contractId: VALID_CONTRACT_ID,
        sorobanRpc: SOROBAN_TESTNET_RPC,
      }),
    );

    await act(async () => {
      await expect(
        result.current.buildTransferXDR({
          from: USDC_ISSUER,
          to: PAYMENT_DESTINATION,
          amount: "1.234",
        }),
      ).rejects.toThrow("more than 2 significant decimal places");
    });

    expect(getAccount).not.toHaveBeenCalled();
    expect(result.current.error?.message).toContain(
      "more than 2 significant decimal places",
    );
  });
});
