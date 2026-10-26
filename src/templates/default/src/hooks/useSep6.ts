'use client';

import { useCallback, useRef, useState } from 'react';
import {
  fetchSep6Info,
  fetchSep6Transaction,
  sep6Deposit,
  sep6Withdraw,
  type Sep6DepositRequest,
  type Sep6DepositResult,
  type Sep6Info,
  type Sep6Transaction,
  type Sep6WithdrawRequest,
  type Sep6WithdrawResult,
} from '../lib/sep6';

// ── Types ──────────────────────────────────────────────────────────────────────

type Configured<T> = Omit<T, 'transferServer' | 'authToken' | 'fetchImpl'>;

export type UseSep6DepositParams = Configured<Sep6DepositRequest>;
export type UseSep6WithdrawParams = Configured<Sep6WithdrawRequest>;

export interface UseSep6Options {
  /** The anchor's SEP-6 `TRANSFER_SERVER` (see `discoverSep6TransferServer`). */
  transferServer: string;
  /** SEP-10 JWT sent as `Authorization: Bearer` on every request. */
  authToken?: string;
  /** Language for anchor-provided descriptions. */
  lang?: string;
  fetchImpl?: typeof fetch;
}

export interface UseSep6Return {
  /** Loads `GET /info` and stores it in `info`. */
  getInfo: () => Promise<Sep6Info>;
  /** Starts a deposit via `GET /deposit`. */
  deposit: (params: UseSep6DepositParams) => Promise<Sep6DepositResult>;
  /** Starts a withdrawal via `GET /withdraw`. */
  withdraw: (params: UseSep6WithdrawParams) => Promise<Sep6WithdrawResult>;
  /** Fetches a transaction's status via `GET /transaction` and stores it in `transaction`. */
  getTransaction: (id: string) => Promise<Sep6Transaction>;
  /** Last `/info` result. */
  info: Sep6Info | undefined;
  /** Last deposit or withdraw result (instructions, or a KYC requirement). */
  result: Sep6DepositResult | Sep6WithdrawResult | undefined;
  /** Last fetched transaction. */
  transaction: Sep6Transaction | undefined;
  /** True when `result` says the anchor needs KYC (SEP-12) before it can proceed. */
  needsCustomerInfo: boolean;
  loading: boolean;
  error: Error | null;
  /** Clears `info`, `result`, `transaction` and `error`, and ignores in-flight responses. */
  reset: () => void;
}

/**
 * React hook for SEP-6 (non-interactive) deposits and withdrawals against a
 * configured anchor `TRANSFER_SERVER`.
 *
 * Nothing is fetched on mount: each call is explicit, because deposit and
 * withdraw requests create transactions on the anchor side. A 403 KYC
 * response is returned as a result (`kind: 'customer_info_needed'` or
 * `'customer_info_status'`) rather than as an error, so the UI can send the
 * user to SEP-12 instead of showing a failure.
 */
export function useSep6(options: UseSep6Options): UseSep6Return {
  const { transferServer, authToken, lang, fetchImpl } = options;

  const [info, setInfo] = useState<Sep6Info | undefined>(undefined);
  const [result, setResult] = useState<Sep6DepositResult | Sep6WithdrawResult | undefined>(
    undefined,
  );
  const [transaction, setTransaction] = useState<Sep6Transaction | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Guards against a slower, older response overwriting a newer one.
  const requestIdRef = useRef(0);

  const run = useCallback(
    async <T>(task: () => Promise<T>, apply: (value: T) => void): Promise<T> => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const value = await task();
        if (requestIdRef.current === requestId) apply(value);
        return value;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (requestIdRef.current === requestId) setError(e);
        throw e;
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
    },
    [],
  );

  const getInfo = useCallback(
    () => run(() => fetchSep6Info({ transferServer, authToken, lang, fetchImpl }), setInfo),
    [run, transferServer, authToken, lang, fetchImpl],
  );

  const deposit = useCallback(
    (params: UseSep6DepositParams) =>
      run(() => sep6Deposit({ lang, ...params, transferServer, authToken, fetchImpl }), setResult),
    [run, transferServer, authToken, lang, fetchImpl],
  );

  const withdraw = useCallback(
    (params: UseSep6WithdrawParams) =>
      run(() => sep6Withdraw({ lang, ...params, transferServer, authToken, fetchImpl }), setResult),
    [run, transferServer, authToken, lang, fetchImpl],
  );

  const getTransaction = useCallback(
    (id: string) =>
      run(() => fetchSep6Transaction({ id, transferServer, authToken, fetchImpl }), setTransaction),
    [run, transferServer, authToken, fetchImpl],
  );

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setInfo(undefined);
    setResult(undefined);
    setTransaction(undefined);
    setError(null);
    setLoading(false);
  }, []);

  return {
    getInfo,
    deposit,
    withdraw,
    getTransaction,
    info,
    result,
    transaction,
    needsCustomerInfo:
      result?.kind === 'customer_info_needed' || result?.kind === 'customer_info_status',
    loading,
    error,
    reset,
  };
}
