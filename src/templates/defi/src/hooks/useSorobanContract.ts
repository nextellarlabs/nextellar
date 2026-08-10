import { useState, useCallback, useMemo } from "react";
import {
  rpc,
  TransactionBuilder,
  Networks,
  Keypair,
  xdr,
  Address,
  Contract,
  Account,
} from "@stellar/stellar-sdk";

/**
 * Options for the useSorobanContract hook
 */
export interface SorobanContractOptions {
  contractId: string;
  sorobanRpc?: string;
  network?: "TESTNET" | "PUBLIC";
}

/**
 * Return type for the useSorobanContract hook
 */
export interface SorobanContractReturn {
  callFunction: (name: string, args: TypedArg[]) => Promise<unknown>;
  buildInvokeXDR: (name: string, args: TypedArg[]) => Promise<string>;
  submitInvokeWithSecret: (
    xdr: string,
    secret: string
  ) => Promise<rpc.Api.SendTransactionResponse>;
  loading: boolean;
  error?: Error | null;
}

/**
 * Supported Soroban type hints for disambiguation.
 *
 * | hint         | JS input                            | JS output       |
 * |--------------|-------------------------------------|-----------------|
 * | `"u32"`      | `number`                            | `number`        |
 * | `"i32"`      | `number`                            | `number`        |
 * | `"u64"`      | `number \| bigint`                  | `bigint`        |
 * | `"i64"`      | `number \| bigint`                  | `bigint`        |
 * | `"u128"`     | `bigint \| string`                  | `bigint`        |
 * | `"i128"`     | `bigint \| string`                  | `bigint`        |
 * | `"bool"`     | `boolean`                           | `boolean`       |
 * | `"string"`   | `string`                            | `string`        |
 * | `"symbol"`   | `string`                            | `string`        |
 * | `"address"`  | `string` (G… or C…)                 | `string`        |
 * | `"bytes"`    | `Uint8Array \| hex string`          | `Uint8Array`    |
 * | `"vec"`      | `TypedArg[]`                        | `unknown[]`     |
 * | `"map"`      | `[TypedArg, TypedArg][]`            | `Map<K,V>`      |
 * | `"enum"`     | `{ tag: string; values?: TypedArg[] }` | `{ tag: string; values: unknown[] }` |
 * | `"timepoint"`| `number` (unix seconds)             | `number`        |
 * | `"duration"` | `number` (seconds)                  | `number`        |
 */
export type SorobanTypeHint =
  | "u32" | "i32"
  | "u64" | "i64"
  | "u128" | "i128"
  | "bool"
  | "string" | "symbol"
  | "address"
  | "bytes"
  | "vec"
  | "map"
  | "enum"
  | "timepoint"
  | "duration";

/**
 * A value passed to contract functions.
 * Can be a plain JS value (auto-detected) or a tagged object for disambiguation.
 *
 * @example
 * // Auto-detected string
 * "hello"
 *
 * // Explicit u128 from BigInt
 * { value: 1_000_000n, type: "u128" }
 *
 * // Bytes from hex string
 * { value: "deadbeef", type: "bytes" }
 *
 * // Enum variant with a value
 * { value: { tag: "Transfer", values: [{ value: 500n, type: "u128" }] }, type: "enum" }
 *
 * // Map from tuple array
 * { value: [["key", "val"]], type: "map" }
 */
export type TypedArg =
  | { value: unknown; type: SorobanTypeHint }
  | string
  | number
  | bigint
  | boolean
  | Uint8Array
  | null
  | undefined;

// ── Internal helpers ──────────────────────────────────────────────────────────

const MASK64 = BigInt("0xFFFFFFFFFFFFFFFF");
const SHIFT64 = BigInt(64);
const ZERO = BigInt(0);

function bigintToU128Parts(n: bigint): { hi: xdr.Uint64; lo: xdr.Uint64 } {
  const hi = n >> SHIFT64;
  const lo = n & MASK64;
  return {
    hi: xdr.Uint64.fromString(String(hi < ZERO ? hi + (MASK64 + BigInt(1)) : hi)),
    lo: xdr.Uint64.fromString(String(lo)),
  };
}

function bigintToI128Parts(n: bigint): { hi: xdr.Int64; lo: xdr.Uint64 } {
  const hi = n >> SHIFT64;
  const lo = n & MASK64;
  return {
    hi: xdr.Int64.fromString(String(hi)),
    lo: xdr.Uint64.fromString(String(lo)),
  };
}

function hiLoToI128(hi: bigint, lo: bigint): bigint {
  return (hi << SHIFT64) | (lo & MASK64);
}

function toBuffer(value: unknown): Buffer {
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") {
    const clean = value.startsWith("0x") ? value.slice(2) : value;
    return Buffer.from(clean, "hex");
  }
  throw new Error(`Cannot convert ${typeof value} to Bytes — expected Uint8Array or hex string`);
}

// ── Main hook ─────────────────────────────────────────────────────────────────

/**
 * Custom React hook for interacting with Soroban smart contracts.
 *
 * Provides a typed abstraction over Soroban XDR encoding/decoding so callers
 * can work with plain JavaScript values. Supports read-only simulation via
 * `callFunction` and transaction building via `buildInvokeXDR`.
 *
 * @param opts - Configuration options including contractId, RPC URL, and network
 * @returns Object with contract interaction methods and state
 *
 * @example
 * ```tsx
 * const { callFunction, loading, error } = useSorobanContract({
 *   contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQAHHXK3AWCM',
 *   sorobanRpc: '{{SOROBAN_URL}}',
 *   network: 'TESTNET',
 * });
 *
 * await callFunction('transfer', [
 *   { value: 'GABC...', type: 'address' },
 *   { value: 1_000_000n, type: 'u128' },
 * ]);
 * ```
 *
 * @security
 * ⚠️ SECURITY WARNING: The submitInvokeWithSecret method is for DEVELOPMENT ONLY.
 * Never store secret keys in production code. Use a secure wallet adapter instead.
 */
export function useSorobanContract(
  opts: SorobanContractOptions
): SorobanContractReturn {
  const {
    contractId,
    sorobanRpc = "{{SOROBAN_URL}}",
    network = "TESTNET",
  } = opts;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const networkPassphrase =
    network === "TESTNET" ? Networks.TESTNET : Networks.PUBLIC;

  const rpcServer = useMemo(() => new rpc.Server(sorobanRpc), [sorobanRpc]);

  const toXdrValue = useCallback((arg: TypedArg): xdr.ScVal => {
    let value: unknown;
    let hint: SorobanTypeHint | undefined;

    if (
      arg !== null &&
      arg !== undefined &&
      typeof arg === "object" &&
      !(arg instanceof Uint8Array) &&
      "value" in arg &&
      "type" in arg
    ) {
      value = (arg as { value: unknown; type: SorobanTypeHint }).value;
      hint = (arg as { value: unknown; type: SorobanTypeHint }).type;
    } else {
      value = arg;
    }

    if (hint === "u32") return xdr.ScVal.scvU32(Number(value));
    if (hint === "i32") return xdr.ScVal.scvI32(Number(value));
    if (hint === "u64") return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(BigInt(String(value)))));
    if (hint === "i64") return xdr.ScVal.scvI64(xdr.Int64.fromString(String(BigInt(String(value)))));
    if (hint === "u128") {
      const n = typeof value === "string" ? BigInt(value) : (value as bigint);
      return xdr.ScVal.scvU128(new xdr.UInt128Parts(bigintToU128Parts(n)));
    }
    if (hint === "i128") {
      const n = typeof value === "string" ? BigInt(value) : (value as bigint);
      return xdr.ScVal.scvI128(new xdr.Int128Parts(bigintToI128Parts(n)));
    }
    if (hint === "bool") return xdr.ScVal.scvBool(Boolean(value));
    if (hint === "string") return xdr.ScVal.scvString(String(value));
    if (hint === "symbol") return xdr.ScVal.scvSymbol(String(value));
    if (hint === "address") return new Address(String(value)).toScVal();
    if (hint === "bytes") return xdr.ScVal.scvBytes(toBuffer(value));
    if (hint === "timepoint") return xdr.ScVal.scvTimepoint(xdr.Uint64.fromString(String(value)));
    if (hint === "duration") return xdr.ScVal.scvDuration(xdr.Uint64.fromString(String(value)));
    if (hint === "vec") {
      const arr = value as TypedArg[];
      return xdr.ScVal.scvVec(arr.map(toXdrValue));
    }
    if (hint === "map") {
      const tuples = value as [TypedArg, TypedArg][];
      const entries = tuples.map(
        ([k, v]) => new xdr.ScMapEntry({ key: toXdrValue(k), val: toXdrValue(v) })
      );
      return xdr.ScVal.scvMap(entries);
    }
    if (hint === "enum") {
      const { tag, values = [] } = value as { tag: string; values?: TypedArg[] };
      return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(tag), ...values.map(toXdrValue)]);
    }

    // Auto-detection
    if (typeof value === "boolean") return xdr.ScVal.scvBool(value);
    if (typeof value === "bigint") return xdr.ScVal.scvI128(new xdr.Int128Parts(bigintToI128Parts(value)));
    if (typeof value === "number") return xdr.ScVal.scvI32(value);
    if (typeof value === "string") {
      if ((value.startsWith("G") || value.startsWith("C")) && value.length === 56) {
        return new Address(value).toScVal();
      }
      return xdr.ScVal.scvString(value);
    }
    if (value instanceof Uint8Array) return xdr.ScVal.scvBytes(Buffer.from(value) as Buffer);
    if (value instanceof Address) return value.toScVal();
    if (value && typeof value === "object" && "_address" in value) {
      return (value as unknown as { toScVal: () => xdr.ScVal }).toScVal();
    }
    if (Array.isArray(value)) return xdr.ScVal.scvVec(value.map(toXdrValue));
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>).map(
        ([k, v]) => new xdr.ScMapEntry({ key: toXdrValue(k), val: toXdrValue(v as TypedArg) })
      );
      return xdr.ScVal.scvMap(entries);
    }
    return xdr.ScVal.scvString(String(value));
  }, []);

  const fromXdrValue = useCallback((scVal: xdr.ScVal): unknown => {
    const type = scVal.switch();

    if (type === xdr.ScValType.scvBool()) return scVal.b();
    if (type === xdr.ScValType.scvVoid()) return null;
    if (type === xdr.ScValType.scvU32()) return scVal.u32();
    if (type === xdr.ScValType.scvI32()) return scVal.i32();
    if (type === xdr.ScValType.scvU64()) return BigInt(scVal.u64().toString());
    if (type === xdr.ScValType.scvI64()) return BigInt(scVal.i64().toString());
    if (type === xdr.ScValType.scvU128()) {
      const parts = scVal.u128();
      return (BigInt(parts.hi().toString()) << SHIFT64) | BigInt(parts.lo().toString());
    }
    if (type === xdr.ScValType.scvI128()) {
      const parts = scVal.i128();
      return hiLoToI128(BigInt(parts.hi().toString()), BigInt(parts.lo().toString()));
    }
    if (type === xdr.ScValType.scvString()) return scVal.str().toString();
    if (type === xdr.ScValType.scvSymbol()) return scVal.sym().toString();
    if (type === xdr.ScValType.scvBytes()) return new Uint8Array(scVal.bytes());
    if (type === xdr.ScValType.scvAddress()) return scVal.address().toString();
    if (type === xdr.ScValType.scvTimepoint()) return Number(scVal.timepoint().toString());
    if (type === xdr.ScValType.scvDuration()) return Number(scVal.duration().toString());
    if (type === xdr.ScValType.scvVec()) {
      const vec = scVal.vec() ?? [];
      const decoded = vec.map(fromXdrValue);
      if (vec.length >= 1 && vec[0].switch() === xdr.ScValType.scvSymbol()) {
        return { tag: vec[0].sym().toString(), values: decoded.slice(1) };
      }
      return decoded;
    }
    if (type === xdr.ScValType.scvMap()) {
      const entries = scVal.map() ?? [];
      const map = new Map<unknown, unknown>();
      for (const entry of entries) {
        map.set(fromXdrValue(entry.key()), fromXdrValue(entry.val()));
      }
      return map;
    }
    return scVal.toString();
  }, []);

  const callFunction = useCallback(
    async (name: string, args: TypedArg[] = []): Promise<unknown> => {
      setLoading(true);
      setError(null);
      try {
        const dummyKeypair = Keypair.random();
        const dummyAccount = new Account(dummyKeypair.publicKey(), "0");
        const contract = new Contract(contractId);
        const operation = contract.call(name, ...args.map(toXdrValue));
        const transaction = new TransactionBuilder(dummyAccount, {
          fee: "100",
          networkPassphrase,
        })
          .addOperation(operation)
          .setTimeout(30)
          .build();
        const simulation = await rpcServer.simulateTransaction(transaction);
        if ("error" in simulation && simulation.error) {
          throw new Error(`Simulation failed: ${simulation.error}`);
        }
        if ("result" in simulation && simulation.result?.retval) {
          setError(null);
          return fromXdrValue(simulation.result.retval);
        }
        setError(null);
        return null;
      } catch (err) {
        const error = err as Error;
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [contractId, networkPassphrase, rpcServer, toXdrValue, fromXdrValue]
  );

  const buildInvokeXDR = useCallback(
    async (name: string, args: TypedArg[] = []): Promise<string> => {
      setLoading(true);
      setError(null);
      try {
        const dummyKeypair = Keypair.random();
        const dummyAccount = new Account(dummyKeypair.publicKey(), "0");
        const contract = new Contract(contractId);
        const operation = contract.call(name, ...args.map(toXdrValue));
        const xdrResult = new TransactionBuilder(dummyAccount, {
          fee: "100",
          networkPassphrase,
        })
          .addOperation(operation)
          .setTimeout(30)
          .build()
          .toXDR();
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
    [contractId, networkPassphrase, toXdrValue]
  );

  const submitInvokeWithSecret = useCallback(
    async (xdr: string, secret: string): Promise<rpc.Api.SendTransactionResponse> => {
      setLoading(true);
      setError(null);
      try {
        const transaction = TransactionBuilder.fromXDR(xdr, networkPassphrase);
        const keypair = Keypair.fromSecret(secret);
        transaction.sign(keypair);
        const result = await rpcServer.sendTransaction(transaction);
        setError(null);
        return result;
      } catch (err) {
        const error = err as Error;
        setError(error);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [networkPassphrase, rpcServer]
  );

  return { callFunction, buildInvokeXDR, submitInvokeWithSecret, loading, error };
}
