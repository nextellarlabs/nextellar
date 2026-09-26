'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Horizon } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const MIN_POLL_MS = 5000;
const MAX_RECONNECT_MS = 30_000;

export interface UseHorizonStreamingOptions {
  horizonUrl?: string;
  /** Poll interval when streaming is unavailable (ms). */
  pollIntervalMs?: number;
  streamType?: 'payments' | 'operations';
  enabled?: boolean;
}

export interface HorizonStreamingState {
  /** True when an active Horizon SSE stream is connected. */
  streaming: boolean;
  /** True when updates are driven by polling fallback. */
  polling: boolean;
  stop: () => void;
}

/**
 * Subscribes to Horizon live updates for an account (EventSource-backed `.stream()`).
 * Reconnects with backoff on drop and falls back to polling when streaming fails.
 */
export function useHorizonStreaming(
  publicKey: string | null | undefined,
  onUpdate: () => void,
  options: UseHorizonStreamingOptions = {},
): HorizonStreamingState {
  const providerConfig = useWalletConfig();
  const {
    horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL,
    pollIntervalMs = 15_000,
    streamType = 'payments',
    enabled = true,
  } = options;

  const [streaming, setStreaming] = useState(false);
  const [polling, setPolling] = useState(false);
  const closeStreamRef = useRef<(() => void) | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setPolling(false);
  }, []);

  const stop = useCallback(() => {
    closeStreamRef.current?.();
    closeStreamRef.current = null;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    clearPoll();
    setStreaming(false);
  }, [clearPoll]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    const interval = Math.max(pollIntervalMs, MIN_POLL_MS);
    pollRef.current = setInterval(() => onUpdateRef.current(), interval);
    setPolling(true);
  }, [pollIntervalMs]);

  useEffect(() => {
    if (!enabled || !publicKey || typeof window === 'undefined') {
      stop();
      return;
    }

    let cancelled = false;
    const server = new Horizon.Server(horizonUrl);
    const requestBuilder =
      streamType === 'operations'
        ? server.operations().forAccount(publicKey)
        : server.payments().forAccount(publicKey);

    const connectStream = () => {
      if (cancelled) return;
      try {
        const close = requestBuilder.cursor('now').stream({
          onmessage: () => {
            reconnectAttemptRef.current = 0;
            setStreaming(true);
            onUpdateRef.current();
          },
          onerror: () => {
            closeStreamRef.current?.();
            closeStreamRef.current = null;
            setStreaming(false);
            startPolling();
            reconnectAttemptRef.current += 1;
            const delay = Math.min(
              1000 * 2 ** reconnectAttemptRef.current,
              MAX_RECONNECT_MS,
            );
            reconnectTimerRef.current = setTimeout(connectStream, delay);
          },
        });
        closeStreamRef.current = close;
        setStreaming(true);
      } catch {
        setStreaming(false);
        startPolling();
      }
    };

    connectStream();

    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled, publicKey, horizonUrl, streamType, startPolling, stop]);

  return { streaming, polling, stop };
}
