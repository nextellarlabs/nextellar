'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { rpc } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_SOROBAN_RPC = 'https://soroban-testnet.stellar.org';
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const ERROR_POLL_MULTIPLIER = 2;       // poll at 2× normal interval after errors
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1_000;         // 1s → 3s → 9s (exponential ×3)

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Typed representation of a single Soroban contract event.
 * Maps the Stellar SDK's EventResponse to a flat, predictable shape.
 */
export interface SorobanEvent {
  id: string;
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  topic: string[];
  value: unknown;
  txHash: string;
  inSuccessfulContractCall: boolean;
}

export type Options = {
  /** Soroban RPC endpoint URL */
  sorobanRpc?: string;
  /** Starting cursor (exclusive). If omitted, newest events are returned. */
  fromCursor?: string;
  /**
   * Polling interval in milliseconds. Pass `null` to disable polling.
   * Defaults to 10 000 ms.
   */
  pollIntervalMs?: number | null;
  /**
   * Optional topic filters. Each inner array is one filter segment (up to 4).
   * Topics are XDR-encoded ScVal strings as returned by the SDK.
   *
   * @example
   * // Only return events whose first topic segment matches "transfer"
   * topics: [["AAAADgAAAAh0cmFuc2Zlcg=="]]
   */
  topics?: string[][];
  /** Maximum number of events returned per poll. Defaults to 100. */
  limit?: number;
};

export type UseSorobanEventsReturn = {
  events: SorobanEvent[];
  loading: boolean;
  /** Trigger a manual fetch immediately (respects retry logic). */
  refresh: () => Promise<void>;
  stopPolling: () => void;
  error: Error | null;
  /**
   * True when the hook is in error-recovery mode (polling at reduced speed
   * after exhausting retries).
   */
  isRecovering: boolean;
};

// ── Helper ─────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Map the SDK's EventResponse to our flat SorobanEvent shape.
 * Topics and values are serialised to strings so consumers never receive
 * raw XDR objects – they can decode further if they need to.
 */
function mapEvent(raw: rpc.Api.EventResponse): SorobanEvent {
  return {
    id: raw.id,
    type: raw.type,
    ledger: raw.ledger,
    ledgerClosedAt: raw.ledgerClosedAt,
    contractId: raw.contractId?.toString() ?? '',
    topic: raw.topic.map((t) => t.toXDR('base64')),
    value: raw.value.toXDR('base64'),
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
export function useSorobanEvents(
  contractId: string,
  opts: Options = {}
): UseSorobanEventsReturn {
  const providerConfig = useWalletConfig();
  const {
    sorobanRpc = providerConfig?.sorobanUrl ?? DEFAULT_SOROBAN_RPC,
    fromCursor,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    topics,
    limit = 100,
  } = opts;

  // ── State ──────────────────────────────────────────────────────────────────

  const [events, setEvents] = useState<SorobanEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);

  // ── Refs ───────────────────────────────────────────────────────────────────

  const cursorRef = useRef<string | undefined>(fromCursor);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const isFetchingRef = useRef(false);

  // ── RPC client ─────────────────────────────────────────────────────────────

  // Re-create only when the URL changes – stable across re-renders.
  const rpcServer = useMemo(() => new rpc.Server(sorobanRpc), [sorobanRpc]);

  // ── Core fetch (no retry) ──────────────────────────────────────────────────

  const fetchOnce = useCallback(async (): Promise<void> => {
    const filter = {
      type: 'contract' as const,
      contractIds: [contractId],
      ...(topics && topics.length > 0 ? { topics } : {}),
    };

    // GetEventsRequest is a discriminated union: cursor mode xor startLedger mode.
    const request = cursorRef.current
      ? { filters: [filter], cursor: cursorRef.current, limit }
      : { filters: [filter], startLedger: 1, limit };

    const response = await rpcServer.getEvents(request);

    if (!isMountedRef.current) return;

    const newEvents = response.events.map(mapEvent);

    setEvents((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      return [...prev, ...newEvents.filter((e) => !seen.has(e.id))];
    });

    // Advance cursor using the response-level cursor for next page
    if (response.cursor) {
      cursorRef.current = response.cursor;
    }
  }, [contractId, rpcServer, topics, limit]);

  // ── Fetch with exponential-backoff retry ───────────────────────────────────

  /**
   * Attempts `fetchOnce` up to MAX_RETRIES times.
   * Returns `true` on success, `false` after exhausting retries.
   */
  const fetchWithRetry = useCallback(async (): Promise<boolean> => {
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      try {
        await fetchOnce();
        return true;
      } catch (err) {
        attempt++;
        if (!isMountedRef.current) return false;

        if (attempt < MAX_RETRIES) {
          // Exponential backoff: 1s, 3s, 9s
          const delay = BACKOFF_BASE_MS * Math.pow(3, attempt - 1);
          await new Promise<void>((resolve) => {
            retryTimerRef.current = setTimeout(resolve, delay);
          });
          if (!isMountedRef.current) return false;
        } else {
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
  const scheduleNextPoll = useCallback(
    (errorMode: boolean) => {
      if (!pollIntervalMs || !isMountedRef.current) return;

      const interval = errorMode
        ? pollIntervalMs * ERROR_POLL_MULTIPLIER
        : pollIntervalMs;

      pollTimerRef.current = setTimeout(async () => {
        if (!isMountedRef.current || isFetchingRef.current) return;

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
        } else {
          setIsRecovering(true);
          scheduleNextPoll(true);
        }
      }, interval);
    },
    [pollIntervalMs, fetchWithRetry]
  );

  // ── Manual refresh ─────────────────────────────────────────────────────────

  const refresh = useCallback(async (): Promise<void> => {
    if (isFetchingRef.current) return;

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
    } else {
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
