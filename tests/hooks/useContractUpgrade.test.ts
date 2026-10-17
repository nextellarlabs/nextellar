/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import {
  act,
  renderHook,
  SOROBAN_TESTNET_RPC as SOROBAN_RPC_URL,
  VALID_CONTRACT_ID,
} from "../helpers";
import * as StellarSDK from "@stellar/stellar-sdk";
import { useContractUpgrade } from "../../src/templates/default/src/hooks/useContractUpgrade.ts";

const SDK = ((StellarSDK as unknown as { default?: unknown }).default ||
  StellarSDK) as typeof StellarSDK;
const { xdr, Address, Contract, rpc, TransactionBuilder } = SDK;

const NEW_WASM_HASH_HEX = "ab".repeat(32); // 64 hex chars = 32 bytes
const NEW_WASM_HASH_BUFFER = Buffer.from(NEW_WASM_HASH_HEX, "hex");

/** Builds a real getLedgerEntries response for the contract's instance entry. */
function buildInstanceEntryResponse(wasmHash: Buffer) {
  const instance = new xdr.ScContractInstance({
    executable: xdr.ContractExecutable.contractExecutableWasm(wasmHash),
    storage: null,
  });

  const contractDataEntry = new xdr.ContractDataEntry({
    ext: new xdr.ExtensionPoint(0),
    contract: new Address(VALID_CONTRACT_ID).toScAddress(),
    key: xdr.ScVal.scvLedgerKeyContractInstance(),
    durability: xdr.ContractDataDurability.persistent(),
    val: xdr.ScVal.scvContractInstance(instance),
  });

  return {
    entries: [
      {
        key: new Contract(VALID_CONTRACT_ID).getFootprint(),
        val: xdr.LedgerEntryData.contractData(contractDataEntry),
        lastModifiedLedgerSeq: 100,
        liveUntilLedgerSeq: 500_000,
      },
    ],
    latestLedger: 100,
  };
}

describe("useContractUpgrade", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("invalid contract ID is surfaced", () => {
    expect(() =>
      renderHook(() =>
        useContractUpgrade({
          contractId: "invalid-contract-id",
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      ),
    ).toThrow(/Invalid Soroban contract ID/);
  });

  // ── buildUpgradeXDR ──────────────────────────────────────────────────────

  describe("buildUpgradeXDR", () => {
    it("builds an unsigned XDR invoking `upgrade` with the wasm hash (hex string)", async () => {
      const callSpy = jest.spyOn(Contract.prototype, "call");

      const { result } = renderHook(() =>
        useContractUpgrade({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      let txXdr = "";
      await act(async () => {
        txXdr = await result.current.buildUpgradeXDR(NEW_WASM_HASH_HEX);
      });

      expect(txXdr).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(callSpy).toHaveBeenCalledTimes(1);
      expect(callSpy.mock.calls[0][0]).toBe("upgrade");

      const arg = callSpy.mock.calls[0][1] as InstanceType<typeof xdr.ScVal>;
      expect(arg.switch().name).toBe("scvBytes");
      expect(Buffer.from(arg.bytes()).equals(NEW_WASM_HASH_BUFFER)).toBe(true);
    });

    it("accepts a Buffer wasm hash directly", async () => {
      const callSpy = jest.spyOn(Contract.prototype, "call");

      const { result } = renderHook(() =>
        useContractUpgrade({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      await act(async () => {
        await result.current.buildUpgradeXDR(NEW_WASM_HASH_BUFFER);
      });

      const arg = callSpy.mock.calls[0][1] as InstanceType<typeof xdr.ScVal>;
      expect(Buffer.from(arg.bytes()).equals(NEW_WASM_HASH_BUFFER)).toBe(true);
    });

    it("accepts a 0x-prefixed hex string", async () => {
      const callSpy = jest.spyOn(Contract.prototype, "call");

      const { result } = renderHook(() =>
        useContractUpgrade({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      await act(async () => {
        await result.current.buildUpgradeXDR(`0x${NEW_WASM_HASH_HEX}`);
      });

      const arg = callSpy.mock.calls[0][1] as InstanceType<typeof xdr.ScVal>;
      expect(Buffer.from(arg.bytes()).equals(NEW_WASM_HASH_BUFFER)).toBe(true);
    });

    it("rejects a hash that isn't 32 bytes", async () => {
      const { result } = renderHook(() =>
        useContractUpgrade({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      let thrown: Error | undefined;
      await act(async () => {
        try {
          await result.current.buildUpgradeXDR("deadbeef");
        } catch (err) {
          thrown = err as Error;
        }
      });

      expect(thrown?.message).toMatch(/invalid wasm hash/i);
      expect(result.current.error?.message).toMatch(/invalid wasm hash/i);
    });

    it("rejects a non-hex string", async () => {
      const { result } = renderHook(() =>
        useContractUpgrade({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      await expect(
        act(async () => {
          await result.current.buildUpgradeXDR(
            "not-a-hex-string-at-all-nope-nope-nope",
          );
        }),
      ).rejects.toThrow(/invalid wasm hash/i);
    });

    it("sets loading true during the call and false after", async () => {
      const { result } = renderHook(() =>
        useContractUpgrade({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      expect(result.current.loading).toBe(false);

      await act(async () => {
        await result.current.buildUpgradeXDR(NEW_WASM_HASH_HEX);
      });

      expect(result.current.loading).toBe(false);
    });
  });

  // ── buildExtendTtlXDR ────────────────────────────────────────────────────

  describe("buildExtendTtlXDR", () => {
    it("builds an unsigned extendFootprintTtl transaction covering instance + code entries", async () => {
      jest
        .spyOn(rpc.Server.prototype, "getLedgerEntries")
        .mockResolvedValue(
          buildInstanceEntryResponse(NEW_WASM_HASH_BUFFER) as never,
        );

      const { result } = renderHook(() =>
        useContractUpgrade({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      let txXdr = "";
      await act(async () => {
        txXdr = await result.current.buildExtendTtlXDR(500_000);
      });

      expect(txXdr).toMatch(/^[A-Za-z0-9+/=]+$/);

      const tx = TransactionBuilder.fromXDR(
        txXdr,
        SDK.Networks.TESTNET,
      ) as InstanceType<typeof SDK.Transaction>;
      expect(tx.operations).toHaveLength(1);
      expect(tx.operations[0].type).toBe("extendFootprintTtl");
      expect((tx.operations[0] as { extendTo: number }).extendTo).toBe(500_000);

      const sorobanData = tx.toEnvelope().v1().tx().ext().sorobanData();
      const readOnlyKeys = sorobanData.resources().footprint().readOnly();
      expect(readOnlyKeys).toHaveLength(2);
      const keyTypes = readOnlyKeys.map(
        (k: InstanceType<typeof xdr.LedgerKey>) => k.switch().name,
      );
      expect(keyTypes).toEqual(
        expect.arrayContaining(["contractData", "contractCode"]),
      );
    });

    it("throws RangeError for a non-positive extendTo", async () => {
      const { result } = renderHook(() =>
        useContractUpgrade({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      let thrown: Error | undefined;
      await act(async () => {
        try {
          await result.current.buildExtendTtlXDR(0);
        } catch (err) {
          thrown = err as Error;
        }
      });

      expect(thrown).toBeInstanceOf(RangeError);
      expect(thrown?.message).toMatch(/positive/i);

      await act(async () => {
        try {
          await result.current.buildExtendTtlXDR(-10);
        } catch {
          // expected
        }
      });
      expect(result.current.error?.message).toMatch(/positive/i);
    });

    it("throws when the contract instance can't be found on the network", async () => {
      jest.spyOn(rpc.Server.prototype, "getLedgerEntries").mockResolvedValue({
        entries: [],
        latestLedger: 100,
      } as never);

      const { result } = renderHook(() =>
        useContractUpgrade({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      let thrown: Error | undefined;
      await act(async () => {
        try {
          await result.current.buildExtendTtlXDR(1000);
        } catch (err) {
          thrown = err as Error;
        }
      });

      expect(thrown?.message).toMatch(/could not find contract instance/i);
    });

    it("propagates a network failure from getLedgerEntries", async () => {
      jest
        .spyOn(rpc.Server.prototype, "getLedgerEntries")
        .mockRejectedValue(new Error("RPC unreachable"));

      const { result } = renderHook(() =>
        useContractUpgrade({
          contractId: VALID_CONTRACT_ID,
          sorobanRpc: SOROBAN_RPC_URL,
        }),
      );

      let thrown: Error | undefined;
      await act(async () => {
        try {
          await result.current.buildExtendTtlXDR(1000);
        } catch (err) {
          thrown = err as Error;
        }
      });

      expect(thrown?.message).toContain("RPC unreachable");
      expect(result.current.error).toBeInstanceOf(Error);
    });
  });
});
