'use client';
import { useCallback, useMemo, useRef, useState } from 'react';
import { fetchSep38FirmQuote, fetchSep38IndicativePrice, } from '../lib/sep38';
/**
 * Cache key for a quote request: two requests with the same key are
 * requesting the same quote and may share a cached response. Includes every
 * input that materially affects the returned price/quote.
 */
function requestKey(params) {
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
export function useSep38Quote(opts = {}) {
    const [quote, setQuote] = useState(undefined);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    // Guards against a stale, slower response from an earlier request
    // overwriting a newer request's result when params change quickly.
    const requestIdRef = useRef(0);
    const lastKeyRef = useRef(undefined);
    const getIndicativePrice = useCallback(async (params) => {
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
                setQuote(result);
            }
            return result;
        }
        catch (err) {
            const e = err instanceof Error ? err : new Error(String(err));
            if (requestIdRef.current === requestId) {
                setError(e);
            }
            throw e;
        }
        finally {
            if (requestIdRef.current === requestId) {
                setLoading(false);
            }
        }
    }, [opts.fetchImpl]);
    const getFirmQuote = useCallback(async (params) => {
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
                setQuote(result);
            }
            return result;
        }
        catch (err) {
            const e = err instanceof Error ? err : new Error(String(err));
            if (requestIdRef.current === requestId) {
                setError(e);
            }
            throw e;
        }
        finally {
            if (requestIdRef.current === requestId) {
                setLoading(false);
            }
        }
    }, [opts.fetchImpl]);
    const isExpired = useMemo(() => {
        if (!quote || quote.kind !== 'firm')
            return false;
        return new Date(quote.expiresAt).getTime() <= Date.now();
    }, [quote]);
    const reset = useCallback(() => {
        requestIdRef.current += 1;
        lastKeyRef.current = undefined;
        setQuote(undefined);
        setError(null);
    }, []);
    return {
        getIndicativePrice,
        getFirmQuote,
        quote,
        loading,
        error,
        isExpired,
        reset,
    };
}
