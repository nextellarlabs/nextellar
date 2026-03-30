'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { rpc } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';
// ── Constants ──────────────────────────────────────────────────────────────────
const DEFAULT_SOROBAN_RPC = 'https://soroban-testnet.stellar.org';
const DEFAULT_POLL_INTERVAL_MS = 10000;
const ERROR_POLL_MULTIPLIER = 2; // poll at 2× normal interval after errors
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000; // 1s → 3s → 9s (exponential ×3)
// ── Helper ─────────────────────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Map the SDK's EventResponse to our flat SorobanEvent shape.
 * Topics and values are serialised to strings so consumers never receive
 * raw XDR objects – they can decode further if they need to.
 */
function mapEvent(raw) {
    return {
        id: raw.id,
        type: raw.type,
        ledger: raw.ledger,
        ledgerClosedAt: raw.ledgerClosedAt,
        contractId: raw.contractId?.toString() ?? '',
        topic: raw.topic.map((t) => t.toXDR('base64')),
        value: raw.value.toXDR('base64'),
        pagingToken: raw.pagingToken,
        txHash: raw.txHash,
        inSuccessfulContractCall: raw.inSuccessfulContractCall,
    };
}
// ── Hook ───────────────────────────────────────────────────────────────────────
/**
 * Custom React hook for polling Soroban contract events with automatic retry,
 * exponential backoff, and reconnection after transient failures.
 *
 * Features:
 * - Uses `@stellar/stellar-sdk` `rpc.Server.getEvents()` instead of raw fetch.
 * - Retries up to 3 times on failure with exponential backoff (1 s → 3 s → 9 s).
 * - After max retries, continues polling at a reduced frequency instead of stopping.
 * - Automatically restores normal poll interval on a successful fetch.
 * - Optional topic filtering via the `topics` option.
 * - Strongly typed `SorobanEvent` interface replaces `Record<string, unknown>`.
 * - Preserves cursor-tracking and event deduplication from the original hook.
 * - Cleans up all timers and in-flight retries on unmount.
 *
 * @param contractId - Soroban contract address to watch.
 * @param opts - Configuration options.
 *
 * @example
 * ```tsx
 * function EventFeed({ contractId }: { contractId: string }) {
 *   const { events, loading, error, isRecovering, refresh, stopPolling } =
 *     useSorobanEvents(contractId, {
 *       pollIntervalMs: 5000,
 *       topics: [["AAAADgAAAAh0cmFuc2Zlcg=="]],
 *     });
 *
 *   return (
 *     <div>
 *       {isRecovering && <p>Connection issue – retrying…</p>}
 *       {loading && <p>Fetching events…</p>}
 *       {error && <p>Error: {error.message} <button onClick={refresh}>Retry</button></p>}
 *       {events.map((e) => (
 *         <div key={e.id}>{e.type} @ ledger {e.ledger}</div>
 *       ))}
 *       <button onClick={stopPolling}>Stop</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useSorobanEvents(contractId, opts = {}) {
    const providerConfig = useWalletConfig();
    const { sorobanRpc = providerConfig?.sorobanUrl ?? DEFAULT_SOROBAN_RPC, fromCursor, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, topics, limit = 100, } = opts;
    // ── State ──────────────────────────────────────────────────────────────────
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isRecovering, setIsRecovering] = useState(false);
    // ── Refs ───────────────────────────────────────────────────────────────────
    const cursorRef = useRef(fromCursor);
    const pollTimerRef = useRef(null);
    const retryTimerRef = useRef(null);
    const isMountedRef = useRef(true);
    const isFetchingRef = useRef(false);
    // ── RPC client ─────────────────────────────────────────────────────────────
    // Re-create only when the URL changes – stable across re-renders.
    const rpcServer = useMemo(() => new rpc.Server(sorobanRpc), [sorobanRpc]);
    // ── Core fetch (no retry) ──────────────────────────────────────────────────
    const fetchOnce = useCallback(async () => {
        const response = await rpcServer.getEvents({
            filters: [
                {
                    type: 'contract',
                    contractIds: [contractId],
                    ...(topics && topics.length > 0 ? { topics } : {}),
                },
            ],
            ...(cursorRef.current ? { cursor: cursorRef.current } : {}),
            limit,
        });
        if (!isMountedRef.current)
            return;
        const newEvents = response.events.map(mapEvent);
        setEvents((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            return [...prev, ...newEvents.filter((e) => !seen.has(e.id))];
        });
        if (newEvents.length > 0) {
            cursorRef.current = newEvents[newEvents.length - 1].pagingToken;
        }
    }, [contractId, rpcServer, topics, limit]);
    // ── Fetch with exponential-backoff retry ───────────────────────────────────
    /**
     * Attempts `fetchOnce` up to MAX_RETRIES times.
     * Returns `true` on success, `false` after exhausting retries.
     */
    const fetchWithRetry = useCallback(async () => {
        let attempt = 0;
        while (attempt < MAX_RETRIES) {
            try {
                await fetchOnce();
                return true;
            }
            catch (err) {
                attempt++;
                if (!isMountedRef.current)
                    return false;
                if (attempt < MAX_RETRIES) {
                    // Exponential backoff: 1s, 3s, 9s
                    const delay = BACKOFF_BASE_MS * Math.pow(3, attempt - 1);
                    await new Promise((resolve) => {
                        retryTimerRef.current = setTimeout(resolve, delay);
                    });
                    if (!isMountedRef.current)
                        return false;
                }
                else {
                    // Surface error after final attempt
                    const error = err instanceof Error ? err : new Error(String(err));
                    setError(error);
                }
            }
        }
        return false;
    }, [fetchOnce]);
    // ── Polling scheduler ──────────────────────────────────────────────────────
    const stopPolling = useCallback(() => {
        if (pollTimerRef.current !== null) {
            clearTimeout(pollTimerRef.current);
            pollTimerRef.current = null;
        }
        if (retryTimerRef.current !== null) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
    }, []);
    /**
     * Schedule the next poll. Uses `errorMode` to slow down after failures.
     */
    const scheduleNextPoll = useCallback((errorMode) => {
        if (!pollIntervalMs || !isMountedRef.current)
            return;
        const interval = errorMode
            ? pollIntervalMs * ERROR_POLL_MULTIPLIER
            : pollIntervalMs;
        pollTimerRef.current = setTimeout(async () => {
            if (!isMountedRef.current || isFetchingRef.current)
                return;
            isFetchingRef.current = true;
            setLoading(true);
            const success = await fetchWithRetry();
            if (!isMountedRef.current) {
                isFetchingRef.current = false;
                return;
            }
            setLoading(false);
            isFetchingRef.current = false;
            if (success) {
                setError(null);
                setIsRecovering(false);
                scheduleNextPoll(false);
            }
            else {
                setIsRecovering(true);
                scheduleNextPoll(true);
            }
        }, interval);
    }, [pollIntervalMs, fetchWithRetry]);
    // ── Manual refresh ─────────────────────────────────────────────────────────
    const refresh = useCallback(async () => {
        if (isFetchingRef.current)
            return;
        stopPolling();
        isFetchingRef.current = true;
        setLoading(true);
        const success = await fetchWithRetry();
        if (!isMountedRef.current) {
            isFetchingRef.current = false;
            return;
        }
        setLoading(false);
        isFetchingRef.current = false;
        if (success) {
            setError(null);
            setIsRecovering(false);
            scheduleNextPoll(false);
        }
        else {
            setIsRecovering(true);
            scheduleNextPoll(true);
        }
    }, [fetchWithRetry, stopPolling, scheduleNextPoll]);
    // ── Initial load + polling setup ───────────────────────────────────────────
    useEffect(() => {
        isMountedRef.current = true;
        cursorRef.current = fromCursor;
        // Run initial fetch immediately, then let refresh schedule polling
        refresh();
        return () => {
            isMountedRef.current = false;
            stopPolling();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contractId, sorobanRpc]);
    return { events, loading, refresh, stopPolling, error, isRecovering };
}
