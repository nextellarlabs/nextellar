import { useState, useCallback, useMemo } from "react";
import {
  rpc,
  TransactionBuilder,
  Networks,
  Keypair,
  xdr,
  Contract,
  Account,
  SorobanDataBuilder,
  Operation,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { isValidContractId } from "./useSorobanContract";

/**
 * Options for the useContractUpgrade hook.
 */
export interface ContractUpgradeOptions {
  contractId: string;
  sorobanRpc?: string;
  network?: "TESTNET" | "PUBLIC";
}

/**
 * Return type for the useContractUpgrade hook.
 */
export interface ContractUpgradeReturn {
  buildUpgradeXDR: (newWasmHash: Buffer | string) => Promise<string>;
  buildExtendTtlXDR: (extendTo: number) => Promise<string>;
  loading: boolean;
  error?: Error | null;
}

/**
 * Convert a wasm hash given as either a Buffer or a hex string into a Buffer.
 */
function toWasmHashBuffer(newWasmHash: Buffer | string): Buffer {
  if (Buffer.isBuffer(newWasmHash)) return newWasmHash;
  if (typeof newWasmHash === "string") {
    const clean = newWasmHash.startsWith("0x") ? newWasmHash.slice(2) : newWasmHash;
    if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
      throw new Error(
        `Invalid wasm hash: "${newWasmHash}". Expected a 32-byte hash as 64 hex characters.`,
      );
    }
    return Buffer.from(clean, "hex");
  }
  throw new Error("newWasmHash must be a Buffer or a hex string");
}

/**
 * Custom React hook for upgrading a deployed Soroban contract's WASM and for
 * extending the TTL (time-to-live) of its on-chain ledger entries.
 *
 * ### Upgrading a contract
 *
 * Soroban contracts are **not** upgraded by the network directly — a
 * contract can only replace its own WASM if it implements an upgrade
 * entrypoint itself (conventionally named `upgrade`, taking the new WASM
 * hash as a `BytesN<32>` argument) that calls the host's
 * `update_current_contract_wasm` function internally. `buildUpgradeXDR`
 * builds the **client-side invocation** of that entrypoint — it does not,
 * and cannot, upgrade a contract that has no such function.
 *
 * @security
 * ⚠️ **This helper requires the target contract to implement an upgrade
 * entrypoint.** If the deployed contract has no `upgrade` function (or
 * whatever it calls its equivalent), the built transaction will fail
 * simulation with a "function not found" error. There is no way to upgrade
 * an immutable contract or one deployed without upgrade support — this is a
 * deliberate Soroban security property, not a limitation of this helper.
 *
 * ### Extending TTL
 *
 * Soroban ledger entries (both a contract's instance entry and its WASM code
 * entry) expire after a `liveUntilLedgerSeq` and must be periodically
 * extended via an `ExtendFootprintTtlOp`, or they become archived and need a
 * `RestoreFootprintOp` first (see `soroban-helpers.ts`'s
 * `simulateAndRestoreIfNeeded`). `buildExtendTtlXDR` extends **both** the
 * contract's instance and its WASM code entries in one transaction, since
 * they're both needed for the contract to keep working and are commonly
 * bumped together as part of upgrade housekeeping.
 *
 * @param opts - Configuration options including contractId, RPC URL, and network
 * @returns Object with upgrade/TTL-extension methods and loading/error state
 *
 * @example
 * ```tsx
 * const { buildUpgradeXDR, buildExtendTtlXDR } = useContractUpgrade({
 *   contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQAHHXK3AWCM',
 * });
 *
 * // Upgrade to a newly-deployed WASM (contract must implement `upgrade`)
 * const upgradeXdr = await buildUpgradeXDR('a1b2c3...'); // 64 hex chars
 *
 * // Extend TTL by ~30 days worth of ledgers (assuming ~5s close time)
 * const extendXdr = await buildExtendTtlXDR(500_000);
 * ```
 */
export function useContractUpgrade(
  opts: ContractUpgradeOptions,
): ContractUpgradeReturn {
  const {
    contractId,
    sorobanRpc = "https://soroban-testnet.stellar.org",
    network = "TESTNET",
  } = opts;

  if (!isValidContractId(contractId)) {
    throw new Error(
      `Invalid Soroban contract ID: "${contractId}". Must be a valid StrKey-encoded contract address (56 characters, starting with "C"). Did you forget to set your contract ID in .env.local?`,
    );
  }

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const networkPassphrase =
    network === "TESTNET" ? Networks.TESTNET : Networks.PUBLIC;

  const rpcServer = useMemo(() => new rpc.Server(sorobanRpc), [sorobanRpc]);

  // ── buildUpgradeXDR ────────────────────────────────────────────────────────

  /**
   * Build an unsigned transaction invoking the contract's `upgrade`
   * entrypoint with the new WASM hash.
   *
   * @param newWasmHash - The new contract WASM's hash, as a 32-byte `Buffer`
   *   or a 64-character hex string (typically the output of deploying the
   *   new WASM via `server.uploadContractWasm` or the CLI's `contract install`).
   * @returns Unsigned XDR string for the `upgrade(new_wasm_hash)` invocation.
   * @throws If `newWasmHash` is not a valid 32-byte hash, or if building the
   *   invocation transaction fails.
   */
  const buildUpgradeXDR = useCallback(
    async (newWasmHash: Buffer | string): Promise<string> => {
      setLoading(true);
      setError(null);

      try {
        const hashBuffer = toWasmHashBuffer(newWasmHash);

        const dummyKeypair = Keypair.random();
        const dummyAccount = new Account(dummyKeypair.publicKey(), "0");

        const contract = new Contract(contractId);
        const operation = contract.call(
          "upgrade",
          xdr.ScVal.scvBytes(hashBuffer),
        );

        const txBuilder = new TransactionBuilder(dummyAccount, {
          fee: BASE_FEE,
          networkPassphrase,
        })
          .addOperation(operation)
          .setTimeout(30);

        const xdrResult = txBuilder.build().toXDR();
        setError(null);
        return xdrResult;
      } catch (err) {
        const error = err as Error;
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [contractId, networkPassphrase],
  );

  // ── buildExtendTtlXDR ──────────────────────────────────────────────────────

  /**
   * Build an unsigned transaction extending the TTL of the contract's
   * instance entry and its WASM code entry by `extendTo` ledgers.
   *
   * Fetches the contract's current WASM hash from the network (needed to
   * build the code entry's footprint key) — this makes a read-only RPC call
   * before building the transaction, unlike the other builders in this file
   * which are purely client-side.
   *
   * @param extendTo - Number of ledgers from the *current* ledger that the
   *   entries' `liveUntilLedgerSeq` should be extended to cover. Must be positive.
   * @returns Unsigned XDR string for the `ExtendFootprintTtlOp`.
   * @throws If `extendTo` is not positive, the contract's instance entry
   *   can't be found (e.g. invalid/undeployed contract ID), or building the
   *   transaction fails.
   */
  const buildExtendTtlXDR = useCallback(
    async (extendTo: number): Promise<string> => {
      if (extendTo <= 0) {
        const err = new RangeError("extendTo has to be positive");
        setError(err);
        throw err;
      }

      setLoading(true);
      setError(null);

      try {
        const contract = new Contract(contractId);
        const instanceKey = contract.getFootprint();

        const instanceEntry = await rpcServer.getLedgerEntries(instanceKey);
        if (instanceEntry.entries.length === 0) {
          throw new Error(
            `Could not find contract instance for "${contractId}" — is it deployed on this network?`,
          );
        }

        const instanceVal = instanceEntry.entries[0].val.contractData().val();
        const wasmHash = instanceVal.instance().executable().wasmHash();
        const codeKey = xdr.LedgerKey.contractCode(
          new xdr.LedgerKeyContractCode({ hash: wasmHash }),
        );

        const dummyKeypair = Keypair.random();
        const dummyAccount = new Account(dummyKeypair.publicKey(), "0");

        const sorobanData = new SorobanDataBuilder()
          .setReadOnly([instanceKey, codeKey])
          .build();

        const txBuilder = new TransactionBuilder(dummyAccount, {
          fee: BASE_FEE,
          networkPassphrase,
        })
          .setSorobanData(sorobanData)
          .addOperation(Operation.extendFootprintTtl({ extendTo }))
          .setTimeout(30);

        const xdrResult = txBuilder.build().toXDR();
        setError(null);
        return xdrResult;
      } catch (err) {
        const error = err as Error;
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [contractId, networkPassphrase, rpcServer],
  );

  return {
    buildUpgradeXDR,
    buildExtendTtlXDR,
    loading,
    error,
  };
}
