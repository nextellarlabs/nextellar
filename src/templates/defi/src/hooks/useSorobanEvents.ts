'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { rpc } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_SOROBAN_RPC = '{{SOROBAN_URL}}';
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const ERROR_POLL_MULTIPLIER = 2;
export const MAX_BACKOFF_MS = 30_000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1_000;

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Typed representation of a single Soroban contract event.
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
  sorobanRpc?: string;
  fromCursor?: string;
  /**
   * Polling interval in milliseconds. Pass `null` to disable polling.
   * Defaults to 10 000 ms.
   */
  pollIntervalMs?: number | null;
  /**
   * Optional topic filters. Each inner array is one filter segment (up to 4).
   *
   * @example
   * topics: [["AAAADgAAAAh0cmFuc2Zlcg=="]]
   */
  topics?: string[][];
  limit?: number;
};

export type UseSorobanEventsReturn = {
  events: SorobanEvent[];
  loading: boolean;
  refresh: () => Promise<void>;
  stopPolling: () => void;
  error: Error | null;
  isRecovering: boolean;
};

// ── Helper ─────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
 * @param contractId - Soroban contract address to watch.
 * @param opts - Configuration options.
 *
 * @example
 * ```tsx
 * const { events, loading, error, isRecovering, refresh, stopPolling } =
 *   useSorobanEvents(contractId, { pollIntervalMs: 5000 });
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

  const [events, setEvents] = useState<SorobanEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);

  const cursorRef = useRef<string | undefined>(fromCursor);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const isFetchingRef = useRef(false);

  const rpcServer = useMemo(() => new rpc.Server(sorobanRpc), [sorobanRpc]);

  const fetchOnce = useCallback(async (): Promise<void> => {
    const filter = {
      type: 'contract' as const,
      contractIds: [contractId],
      ...(topics && topics.length > 0 ? { topics } : {}),
    };

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

    if (response.cursor) {
      cursorRef.current = response.cursor;
    }
  }, [contractId, rpcServer, topics, limit]);

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
          const delay = BACKOFF_BASE_MS * Math.pow(3, attempt - 1);
          await new Promise<void>((resolve) => {
            retryTimerRef.current = setTimeout(resolve, delay);
          });
          if (!isMountedRef.current) return false;
        } else {
          const error = err instanceof Error ? err : new Error(String(err));
          setError(error);
        }
      }
    }

    return false;
  }, [fetchOnce]);

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

  const scheduleNextPoll = useCallback(
    (errorMode: boolean) => {
      if (!pollIntervalMs || !isMountedRef.current) return;

      const interval = errorMode
        ? Math.min(pollIntervalMs * ERROR_POLL_MULTIPLIER, MAX_BACKOFF_MS)
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

  useEffect(() => {
    isMountedRef.current = true;
    isFetchingRef.current = false;
    cursorRef.current = fromCursor;

    refresh();

    return () => {
      isMountedRef.current = false;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId, sorobanRpc]);

  // suppress unused import warning for sleep (kept for future use)
  void sleep;

  return { events, loading, refresh, stopPolling, error, isRecovering };
}
