'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  rpc,
  TransactionBuilder,
  Networks,
  Keypair,
  xdr,
  Address,
  Contract,
  Account,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';
import { isValidContractId, type TypedArg, type SorobanTypeHint } from './useSorobanContract';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_SOROBAN_RPC = 'https://soroban-testnet.stellar.org';
const DEFAULT_NETWORK = 'TESTNET';
const DEFAULT_STALE_TIME_MS = 30_000;
const DEFAULT_CACHE_TIME_MS = 5 * 60_000;

const MASK64 = BigInt('0xFFFFFFFFFFFFFFFF');
const SHIFT64 = BigInt(64);
const ZERO = BigInt(0);

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Options for the `useContractRead` hook.
 */
export interface UseContractReadOptions {
  /** StrKey-encoded Soroban contract ID (56 characters, starting with `"C"`). */
  contractId: string;
  /** Contract method name to simulate. */
  method: string;
  /** Arguments passed to the contract method. Defaults to `[]`. */
  args?: TypedArg[];
  /** Soroban RPC URL. Falls back to `WalletProvider`'s `sorobanUrl`, then testnet default. */
  sorobanRpc?: string;
  /** Stellar network (`"TESTNET"` or `"PUBLIC"`). Defaults to `"TESTNET"`. */
  network?: 'TESTNET' | 'PUBLIC';
  /**
   * Time in milliseconds during which cached data is considered fresh and
   * served without triggering a background revalidation. Defaults to `30000` (30s).
   */
  staleTime?: number;
  /**
   * Maximum time in milliseconds to retain an entry in the module-level cache
   * before it is evicted. Defaults to `300000` (5m).
   */
  cacheTime?: number;
  /**
   * Optional interval in milliseconds to automatically refetch in the background.
   * Disabled when omitted or `<= 0`.
   */
  refetchInterval?: number;
  /**
   * When `false`, the hook will not execute simulation calls automatically.
   * Defaults to `true`.
   */
  enabled?: boolean;
}

/**
 * Return value of the `useContractRead` hook.
 */
export interface UseContractReadReturn<T = unknown> {
  /** Decoded return value from the most recent successful simulation, or `undefined` if not yet loaded. */
  data: T | undefined;
  /** `true` while an initial fetch (with no cached data) is in flight. */
  loading: boolean;
  /** `true` whenever any simulation request (initial or background revalidation) is in flight. */
  isValidating: boolean;
  /** Error from the most recent failed simulation, or `null` when healthy. */
  error: Error | null;
  /** `true` when the currently displayed `data` is older than `staleTime`. */
  isStale: boolean;
  /** Trigger an immediate re-simulation, updating the cache with the fresh result. */
  refetch: () => Promise<T | undefined>;
  /**
   * Evict this call's cache entry and immediately re-simulate (if `enabled`).
   */
  invalidate: () => Promise<T | undefined>;
}

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
  cacheTime: number;
}

// ── Module-level cache & in-flight deduplication ──────────────────────────────

const readCache = new Map<string, CacheEntry<unknown>>();
const inFlightRequests = new Map<string, Promise<unknown>>();
const cacheListeners = new Set<(invalidatedKey?: string) => void>();

/**
 * Deterministic serializer for contract arguments so cache keys remain stable
 * across renders even for `bigint`, `Uint8Array`, and nested objects.
 */
function serializeArg(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'bigint') return `bigint:${value.toString()}`;
  if (value instanceof Uint8Array) {
    return `bytes:${Array.from(value).join(',')}`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(serializeArg).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${serializeArg(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Build a deterministic cache key for a contract read call.
 */
export function buildContractReadCacheKey(
  contractId: string,
  method: string,
  args: TypedArg[],
  network: 'TESTNET' | 'PUBLIC',
  sorobanRpc: string
): string {
  return `${network}|${sorobanRpc}|${contractId}|${method}|${serializeArg(args)}`;
}

/**
 * Invalidate cached `useContractRead` entries.
 *
 * - With no arguments: clears the entire cache.
 * - With a `prefix` (e.g. a `contractId` or full cache key): removes all entries
 *   whose key contains `prefix`.
 *
 * Active mounted `useContractRead` hooks matching the invalidated entries are
 * notified so they can revalidate.
 */
export function invalidateContractReadCache(keyOrContractId?: string): void {
  if (!keyOrContractId) {
    readCache.clear();
  } else {
    for (const key of Array.from(readCache.keys())) {
      if (key === keyOrContractId || key.includes(keyOrContractId)) {
        readCache.delete(key);
      }
    }
  }
  cacheListeners.forEach((listener) => listener(keyOrContractId));
}

/**
 * Clear all cached entries and in-flight request references.
 * Primarily useful in tests for isolation between runs.
 */
export function clearContractReadCache(): void {
  readCache.clear();
  inFlightRequests.clear();
}

function getCachedEntry<T>(key: string): CacheEntry<T> | undefined {
  const entry = readCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > entry.cacheTime) {
    readCache.delete(key);
    return undefined;
  }
  return entry;
}

// ── XDR encoding / decoding helpers ───────────────────────────────────────────

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
  if (typeof value === 'string') {
    const clean = value.startsWith('0x') ? value.slice(2) : value;
    return Buffer.from(clean, 'hex');
  }
  throw new Error(`Cannot convert ${typeof value} to Bytes — expected Uint8Array or hex string`);
}

function toXdrValue(arg: TypedArg): xdr.ScVal {
  let value: unknown;
  let hint: SorobanTypeHint | undefined;

  if (
    arg !== null &&
    arg !== undefined &&
    typeof arg === 'object' &&
    !(arg instanceof Uint8Array) &&
    'value' in arg &&
    'type' in arg
  ) {
    value = (arg as { value: unknown; type: SorobanTypeHint }).value;
    hint = (arg as { value: unknown; type: SorobanTypeHint }).type;
  } else {
    value = arg;
  }

  if (hint === 'u32') return xdr.ScVal.scvU32(Number(value));
  if (hint === 'i32') return xdr.ScVal.scvI32(Number(value));
  if (hint === 'u64') return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(BigInt(String(value)))));
  if (hint === 'i64') return xdr.ScVal.scvI64(xdr.Int64.fromString(String(BigInt(String(value)))));
  if (hint === 'u128') {
    const n = typeof value === 'string' ? BigInt(value) : (value as bigint);
    return xdr.ScVal.scvU128(new xdr.UInt128Parts(bigintToU128Parts(n)));
  }
  if (hint === 'i128') {
    const n = typeof value === 'string' ? BigInt(value) : (value as bigint);
    return xdr.ScVal.scvI128(new xdr.Int128Parts(bigintToI128Parts(n)));
  }
  if (hint === 'bool') return xdr.ScVal.scvBool(Boolean(value));
  if (hint === 'string') return xdr.ScVal.scvString(String(value));
  if (hint === 'symbol') return xdr.ScVal.scvSymbol(String(value));
  if (hint === 'address') return new Address(String(value)).toScVal();
  if (hint === 'bytes') return xdr.ScVal.scvBytes(toBuffer(value));
  if (hint === 'timepoint') return xdr.ScVal.scvTimepoint(xdr.Uint64.fromString(String(value)));
  if (hint === 'duration') return xdr.ScVal.scvDuration(xdr.Uint64.fromString(String(value)));
  if (hint === 'vec') return xdr.ScVal.scvVec((value as TypedArg[]).map(toXdrValue));
  if (hint === 'map') {
    const tuples = value as [TypedArg, TypedArg][];
    return xdr.ScVal.scvMap(
      tuples.map(([k, v]) => new xdr.ScMapEntry({ key: toXdrValue(k), val: toXdrValue(v) }))
    );
  }
  if (hint === 'enum') {
    const { tag, values = [] } = value as { tag: string; values?: TypedArg[] };
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(tag), ...values.map(toXdrValue)]);
  }

  if (typeof value === 'boolean') return xdr.ScVal.scvBool(value);
  if (typeof value === 'bigint') {
    return xdr.ScVal.scvI128(new xdr.Int128Parts(bigintToI128Parts(value)));
  }
  if (typeof value === 'number') return xdr.ScVal.scvI32(value);
  if (typeof value === 'string') {
    if ((value.startsWith('G') || value.startsWith('C')) && value.length === 56) {
      return new Address(value).toScVal();
    }
    return xdr.ScVal.scvString(value);
  }
  if (value instanceof Uint8Array) return xdr.ScVal.scvBytes(Buffer.from(value) as Buffer);
  if (value instanceof Address) return value.toScVal();
  if (Array.isArray(value)) return xdr.ScVal.scvVec(value.map(toXdrValue));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => new xdr.ScMapEntry({ key: toXdrValue(k), val: toXdrValue(v as TypedArg) })
    );
    return xdr.ScVal.scvMap(entries);
  }

  return xdr.ScVal.scvString(String(value));
}

function fromXdrValue(scVal: xdr.ScVal): unknown {
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
    const result: Record<string, unknown> = {};
    for (const entry of entries) {
      result[String(fromXdrValue(entry.key()))] = fromXdrValue(entry.val());
    }
    return result;
  }

  return scVal.toString();
}

// ── Main hook ─────────────────────────────────────────────────────────────────

/**
 * React hook for cached, read-only Soroban contract calls with
 * stale-while-revalidate (SWR) semantics.
 *
 * Calls are executed strictly via `rpc.Server.simulateTransaction` (no signing
 * or submission) and cached in memory by `(network, sorobanRpc, contractId,
 * method, args)`. When cached data exists and is older than `staleTime`, the
 * stale value is returned immediately while a background revalidation refreshes
 * it.
 *
 * @example
 * ```tsx
 * function TokenBalance({ contractId, account }: { contractId: string; account: string }) {
 *   const { data, loading, error, refetch, invalidate } = useContractRead<bigint>({
 *     contractId,
 *     method: 'balance',
 *     args: [{ value: account, type: 'address' }],
 *     staleTime: 15_000,
 *     refetchInterval: 30_000,
 *   });
 *
 *   if (loading) return <p>Loading balance...</p>;
 *   if (error) return <p>Error: {error.message}</p>;
 *
 *   return (
 *     <div>
 *       <p>Balance: {data?.toString()}</p>
 *       <button onClick={() => refetch()}>Refresh</button>
 *       <button onClick={() => invalidate()}>Invalidate</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useContractRead<T = unknown>(
  options: UseContractReadOptions
): UseContractReadReturn<T> {
  const providerConfig = useWalletConfig();
  const {
    contractId,
    method,
    args = [],
    sorobanRpc = providerConfig?.sorobanUrl ?? DEFAULT_SOROBAN_RPC,
    network = DEFAULT_NETWORK,
    staleTime = DEFAULT_STALE_TIME_MS,
    cacheTime = DEFAULT_CACHE_TIME_MS,
    refetchInterval,
    enabled = true,
  } = options;

  const networkPassphrase = network === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;
  const rpcServer = useMemo(() => new rpc.Server(sorobanRpc), [sorobanRpc]);

  const cacheKey = useMemo(
    () => buildContractReadCacheKey(contractId, method, args, network, sorobanRpc),
    [contractId, method, args, network, sorobanRpc]
  );

  // Keep latest args in a ref so callbacks keyed on cacheKey stay stable
  const argsRef = useRef<TypedArg[]>(args);
  argsRef.current = args;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const initialEntry = getCachedEntry<T>(cacheKey);

  const [data, setData] = useState<T | undefined>(initialEntry?.data);
  const [loading, setLoading] = useState<boolean>(Boolean(enabled && !initialEntry));
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [isStale, setIsStale] = useState<boolean>(
    initialEntry ? Date.now() - initialEntry.timestamp >= staleTime : false
  );

  const executeSimulation = useCallback(
    async (bypassInFlight = false): Promise<T | undefined> => {
      if (!isValidContractId(contractId)) {
        const err = new Error(
          `Invalid Soroban contract ID: "${contractId}". Must be a valid StrKey-encoded contract address (56 characters, starting with "C").`
        );
        if (mountedRef.current) {
          setError(err);
          setLoading(false);
          setIsValidating(false);
        }
        return undefined;
      }

      if (!method || typeof method !== 'string' || method.trim().length === 0) {
        const err = new Error('Contract method name must be a non-empty string.');
        if (mountedRef.current) {
          setError(err);
          setLoading(false);
          setIsValidating(false);
        }
        return undefined;
      }

      const existingEntry = getCachedEntry<T>(cacheKey);
      if (mountedRef.current) {
        setIsValidating(true);
        if (!existingEntry) {
          setLoading(true);
        }
      }

      try {
        let promise = !bypassInFlight ? inFlightRequests.get(cacheKey) : undefined;

        if (!promise) {
          promise = (async () => {
            const dummyKeypair = Keypair.random();
            const dummyAccount = new Account(dummyKeypair.publicKey(), '0');
            const contract = new Contract(contractId);
            const operation = contract.call(method, ...argsRef.current.map(toXdrValue));

            const transaction = new TransactionBuilder(dummyAccount, {
              fee: BASE_FEE,
              networkPassphrase,
            })
              .addOperation(operation)
              .setTimeout(30)
              .build();

            const simulation = await rpcServer.simulateTransaction(transaction);

            if ('error' in simulation && simulation.error) {
              const errMessage =
                typeof simulation.error === 'string'
                  ? simulation.error
                  : JSON.stringify(simulation.error);
              throw new Error(`Simulation error: ${errMessage}`);
            }

            if ('result' in simulation && simulation.result?.retval) {
              return fromXdrValue(simulation.result.retval);
            }

            return null;
          })();

          inFlightRequests.set(cacheKey, promise);
        }

        const result = (await promise) as T;

        readCache.set(cacheKey, {
          data: result,
          timestamp: Date.now(),
          cacheTime,
        });

        if (mountedRef.current) {
          setData(result);
          setError(null);
          setIsStale(false);
        }

        return result;
      } catch (err: unknown) {
        const normalized =
          err instanceof Error ? err : new Error('Failed to simulate Soroban contract call');
        if (mountedRef.current) {
          setError(normalized);
        }
        return undefined;
      } finally {
        inFlightRequests.delete(cacheKey);
        if (mountedRef.current) {
          setLoading(false);
          setIsValidating(false);
        }
      }
    },
    [cacheKey, cacheTime, contractId, method, networkPassphrase, rpcServer]
  );

  // Sync with cache and trigger initial / SWR fetch when key or enabled changes
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setIsValidating(false);
      return;
    }

    const cached = getCachedEntry<T>(cacheKey);
    if (cached) {
      const stale = Date.now() - cached.timestamp >= staleTime;
      setData(cached.data);
      setError(null);
      setLoading(false);
      setIsStale(stale);

      if (stale) {
        void executeSimulation();
      }
    } else {
      setData(undefined);
      setIsStale(false);
      void executeSimulation();
    }
  }, [cacheKey, enabled, staleTime, executeSimulation]);

  // Listen for external cache invalidations
  useEffect(() => {
    const onInvalidate = (invalidatedKey?: string) => {
      if (!enabled) return;
      if (!invalidatedKey || cacheKey === invalidatedKey || cacheKey.includes(invalidatedKey)) {
        setIsStale(true);
        void executeSimulation(true);
      }
    };

    cacheListeners.add(onInvalidate);
    return () => {
      cacheListeners.delete(onInvalidate);
    };
  }, [cacheKey, enabled, executeSimulation]);

  // Optional interval refetch
  useEffect(() => {
    if (!enabled || !refetchInterval || refetchInterval <= 0) {
      return;
    }

    const id = setInterval(() => {
      void executeSimulation(true);
    }, refetchInterval);

    return () => {
      clearInterval(id);
    };
  }, [enabled, refetchInterval, executeSimulation]);

  const refetch = useCallback(async (): Promise<T | undefined> => {
    return executeSimulation(true);
  }, [executeSimulation]);

  const invalidate = useCallback(async (): Promise<T | undefined> => {
    readCache.delete(cacheKey);
    if (mountedRef.current) {
      setIsStale(true);
    }
    if (!enabled) {
      return undefined;
    }
    return executeSimulation(true);
  }, [cacheKey, enabled, executeSimulation]);

  return {
    data,
    loading,
    isValidating,
    error,
    isStale,
    refetch,
    invalidate,
  };
}
