import { useState, useEffect, useCallback, useRef } from 'react'

type Options = {
    sorobanRpc?: string
    fromCursor?: string | number
    pollIntervalMs?: number | null
}

type SorobanEvent = {
    id?: string;
    paging_token?: string;
    [key: string]: unknown;
};

type UseSorobanEventsReturn = {
    events: SorobanEvent[];
    loading: boolean;
    refresh: () => Promise<void>;
    stopPolling: () => void;
    error: Error | null;
}

export function useSorobanEvents(
    contractId: string,
    opts: Options = {}
): UseSorobanEventsReturn {
    const { sorobanRpc = 'https://rpc-futurenet.stellar.org', fromCursor, pollIntervalMs = null } = opts

    const [events, setEvents] = useState<SorobanEvent[]>([]);
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)
    const cursorRef = useRef<string | number | undefined>(fromCursor)
    const pollTimer = useRef<NodeJS.Timeout | null>(null)

    const fetchEvents = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams({
                contractId,
                ...(cursorRef.current ? { cursor: String(cursorRef.current) } : {})
            })
            const res = await fetch(`${sorobanRpc}/events?${params.toString()}`)
            if (!res.ok) throw new Error(`RPC error ${res.status}`)
            const data = await res.json()
            const newEvents = data.events || []
            setEvents((prev: SorobanEvent[]) => {
                const seen = new Set(prev.map((e: SorobanEvent) => e.id ?? e.paging_token));
                return [...prev, ...newEvents.filter((e: SorobanEvent) => !seen.has(e.id ?? e.paging_token))];
            });
            if (newEvents.length > 0) {
                const last = newEvents[newEvents.length - 1]
                cursorRef.current = last.paging_token ?? cursorRef.current
            }
            setError(null)
        } catch (err) {
            setError(err as Error)
        } finally {
            setLoading(false)
        }
    }, [contractId, sorobanRpc])

    const refresh = useCallback(async () => { await fetchEvents() }, [fetchEvents])
    const stopPolling = useCallback(() => {
        if (pollTimer.current) {
            clearInterval(pollTimer.current)
            pollTimer.current = null
        }
    }, [])

    useEffect(() => {
        fetchEvents()
        if (pollIntervalMs) {
            pollTimer.current = setInterval(fetchEvents, pollIntervalMs)
        }
        return () => stopPolling()
    }, [fetchEvents, pollIntervalMs, stopPolling])

    return { events, loading, refresh, stopPolling, error }
}
