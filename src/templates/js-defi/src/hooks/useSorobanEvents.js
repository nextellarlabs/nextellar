'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { rpc } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';

const DEFAULT_SOROBAN_RPC = '{{SOROBAN_URL}}';
const DEFAULT_POLL_INTERVAL_MS = 10000;
const ERROR_POLL_MULTIPLIER = 2;
export const MAX_BACKOFF_MS = 30000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

function mapEvent(raw) {
    return {
        id: raw.id,
        type: raw.type,
        ledger: raw.ledger,
        ledgerClosedAt: raw.ledgerClosedAt,
        contractId: raw.contractId?.toString() ?? '',
        topic: raw.topic.map((topic) => topic.toXDR('base64')),
        value: raw.value.toXDR('base64'),
        txHash: raw.txHash,
        inSuccessfulContractCall: raw.inSuccessfulContractCall,
    };
}

export function useSorobanEvents(contractId, opts = {}) {
    const providerConfig = useWalletConfig();
    const {
        sorobanRpc = providerConfig?.sorobanUrl ?? DEFAULT_SOROBAN_RPC,
        fromCursor,
        pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
        topics,
        limit = 100,
    } = opts;
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isRecovering, setIsRecovering] = useState(false);
    const cursorRef = useRef(fromCursor);
    const pollTimerRef = useRef(null);
    const retryTimerRef = useRef(null);
    const isMountedRef = useRef(true);
    const isFetchingRef = useRef(false);
    const rpcServer = useMemo(() => new rpc.Server(sorobanRpc), [sorobanRpc]);

    const fetchOnce = useCallback(async () => {
        const filter = {
            type: 'contract',
            contractIds: [contractId],
            ...(topics && topics.length > 0 ? { topics } : {}),
        };
        const request = cursorRef.current
            ? { filters: [filter], cursor: cursorRef.current, limit }
            : { filters: [filter], startLedger: 1, limit };
        const response = await rpcServer.getEvents(request);
        if (!isMountedRef.current) return;
        const newEvents = response.events.map(mapEvent);
        setEvents((previous) => {
            const seen = new Set(previous.map((event) => event.id));
            return [...previous, ...newEvents.filter((event) => !seen.has(event.id))];
        });
        if (response.cursor) cursorRef.current = response.cursor;
    }, [contractId, rpcServer, topics, limit]);

    const fetchWithRetry = useCallback(async () => {
        let attempt = 0;
        while (attempt < MAX_RETRIES) {
            try {
                await fetchOnce();
                return true;
            } catch (err) {
                attempt++;
                if (!isMountedRef.current) return false;
                if (attempt < MAX_RETRIES) {
                    const delay = Math.min(BACKOFF_BASE_MS * Math.pow(3, attempt - 1), MAX_BACKOFF_MS);
                    await new Promise((resolve) => {
                        retryTimerRef.current = setTimeout(resolve, delay);
                    });
                    if (!isMountedRef.current) return false;
                } else {
                    setError(err instanceof Error ? err : new Error(String(err)));
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

    const scheduleNextPoll = useCallback((errorMode) => {
        if (!pollIntervalMs || !isMountedRef.current) return;
        const interval = errorMode ? Math.min(pollIntervalMs * ERROR_POLL_MULTIPLIER, MAX_BACKOFF_MS) : pollIntervalMs;
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
    }, [pollIntervalMs, fetchWithRetry]);

    const refresh = useCallback(async () => {
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

    return { events, loading, refresh, stopPolling, error, isRecovering };
}