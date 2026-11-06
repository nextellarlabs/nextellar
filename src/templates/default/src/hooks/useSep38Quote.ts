'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  fetchSep38FirmQuote,
  fetchSep38IndicativePrice,
  type Sep38Asset,
  type Sep38FirmQuote,
  type Sep38IndicativePrice,
  type Sep38Quote,
} from '../lib/sep38';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Sep38QuoteParams {
  quoteServer: string;
  sellAsset: Sep38Asset;
  buyAsset: Sep38Asset;
  /** Exactly one of sellAmount/buyAmount is required. */
  sellAmount?: string;
  buyAmount?: string;
  context: 'sep6' | 'sep31';
}

export interface UseSep38QuoteOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Error thrown by `executeWithQuote` when the quote it was handed cannot be
 * used to build/submit a transaction — an expired firm quote, or a non-firm
 * (indicative) price. Named distinctly so callers can tell expiry apart from
 * other failures.
 */
export class Sep38StaleQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Sep38StaleQuoteError';
  }
}

export interface UseSep38QuoteReturn {
  /** Requests an indicative (non-binding) price via GET /price. */
  getIndicativePrice: (
    params: Sep38QuoteParams,
  ) => Promise<Sep38IndicativePrice>;
  /** Requests a firm, binding quote via POST /quote. Requires a SEP-10 authToken. */
  getFirmQuote: (
    params: Sep38QuoteParams & { authToken: string; expireAfter?: string },
  ) => Promise<Sep38FirmQuote>;
  /**
   * Guards the step between holding a quote and spending it: validates the
   * given quote (or the most recently resolved one) and only then invokes
   * `buildAndSubmit`. Rejects with a `Sep38StaleQuoteError` **before**
   * `buildAndSubmit` runs if the quote is missing, is an indicative (never
   * executable) price, or is a firm quote whose `expiresAt` has passed at
   * call time. A rejected stale quote is never silently accepted.
   */
  executeWithQuote: <T>(
    buildAndSubmit: (quote: Sep38FirmQuote) => Promise<T>,
    quote?: Sep38Quote,
  ) => Promise<T>;
  /** The most recently resolved quote/price, indicative or firm. */
  quote: Sep38IndicativePrice | Sep38FirmQuote | undefined;
  loading: boolean;
  error: Error | null;
  /** True once `quote` is a firm quote whose `expiresAt` has passed. Always false for an indicative price (it has no expiry). */
  isExpired: boolean;
  /** Clears `quote` and `error`. */
  reset: () => void;
}

/**
 * Cache key for a quote request: two requests with the same key are
 * requesting the same quote and may share a cached response. Includes every
 * input that materially affects the returned price/quote.
 */
function requestKey(
  params: Sep38QuoteParams & { expireAfter?: string },
): string {
  return JSON.stringify([
    params.quoteServer,
    params.sellAsset,
    params.buyAsset,
    params.sellAmount ?? null,
    params.buyAmount ?? null,
    params.context,
    params.expireAfter ?? null,
  ]);
}

/**
 * React hook for requesting SEP-38 indicative prices and firm quotes.
 *
 * Does not fetch on mount or on every render — a quote is only requested
 * when `getIndicativePrice`/`getFirmQuote` is called explicitly, since a
 * quote request has cost/rate-limit implications on the anchor side and a
 * firm quote especially should never be requested unintentionally.
 *
 * A firm quote's `expiresAt` is taken as-is from the anchor's response and
 * is never fabricated or extended client-side; `isExpired` simply reports
 * whether that timestamp has passed.
 */
export function useSep38Quote(
  opts: UseSep38QuoteOptions = {},
): UseSep38QuoteReturn {
  const [quote, setQuote] = useState<
    Sep38IndicativePrice | Sep38FirmQuote | undefined
  >(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Guards against a stale, slower response from an earlier request
  // overwriting a newer request's result when params change quickly.
  const requestIdRef = useRef(0);
  const lastKeyRef = useRef<string | undefined>(undefined);
  // Mirror of `quote` readable at call time (not render time), so
  // executeWithQuote always validates the freshest state.
  const quoteRef = useRef<Sep38IndicativePrice | Sep38FirmQuote | undefined>(
    undefined,
  );

  const commitQuote = useCallback(
    (q: Sep38IndicativePrice | Sep38FirmQuote | undefined) => {
      quoteRef.current = q;
      setQuote(q);
    },
    [],
  );

  const getIndicativePrice = useCallback(
    async (params: Sep38QuoteParams): Promise<Sep38IndicativePrice> => {
      const key = requestKey(params);
      const requestId = ++requestIdRef.current;
      lastKeyRef.current = key;
      setLoading(true);
      setError(null);
      try {
        const result = await fetchSep38IndicativePrice({
          ...params,
          fetchImpl: opts.fetchImpl,
        });
        if (requestIdRef.current === requestId) {
          commitQuote(result);
        }
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (requestIdRef.current === requestId) {
          setError(e);
        }
        throw e;
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [opts.fetchImpl, commitQuote],
  );

  const getFirmQuote = useCallback(
    async (
      params: Sep38QuoteParams & { authToken: string; expireAfter?: string },
    ): Promise<Sep38FirmQuote> => {
      const key = requestKey(params);
      const requestId = ++requestIdRef.current;
      lastKeyRef.current = key;
      setLoading(true);
      setError(null);
      try {
        const result = await fetchSep38FirmQuote({
          ...params,
          fetchImpl: opts.fetchImpl,
        });
        if (requestIdRef.current === requestId) {
          commitQuote(result);
        }
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (requestIdRef.current === requestId) {
          setError(e);
        }
        throw e;
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [opts.fetchImpl, commitQuote],
  );

  const isExpired = useMemo(() => {
    if (!quote || quote.kind !== 'firm') return false;
    return new Date(quote.expiresAt).getTime() <= Date.now();
  }, [quote]);

  // Re-checks expiry at *call* time (not render time): a firm quote fetched
  // minutes ago may have expired since the last render, so `isExpired` alone
  // cannot be trusted as the gate right before building/submitting.
  const executeWithQuote = useCallback(
    async <T>(
      buildAndSubmit: (quote: Sep38FirmQuote) => Promise<T>,
      quoteOverride?: Sep38Quote,
    ): Promise<T> => {
      const target = quoteOverride ?? quoteRef.current;
      if (!target) {
        const e = new Sep38StaleQuoteError(
          'executeWithQuote: no quote available — request a firm quote via getFirmQuote before building a transaction.',
        );
        setError(e);
        throw e;
      }
      if (target.kind !== 'firm') {
        const e = new Sep38StaleQuoteError(
          'executeWithQuote: an indicative price is not binding and cannot be used to build a transaction — request a firm quote via getFirmQuote first.',
        );
        setError(e);
        throw e;
      }
      if (new Date(target.expiresAt).getTime() <= Date.now()) {
        const e = new Sep38StaleQuoteError(
          `executeWithQuote: firm quote "${target.id}" expired at ${target.expiresAt} — request a fresh quote before building a transaction.`,
        );
        setError(e);
        throw e;
      }
      return buildAndSubmit(target);
    },
    [],
  );

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    lastKeyRef.current = undefined;
    commitQuote(undefined);
    setError(null);
  }, [commitQuote]);

  return {
    getIndicativePrice,
    getFirmQuote,
    executeWithQuote,
    quote,
    loading,
    error,
    isExpired,
    reset,
  };
}
