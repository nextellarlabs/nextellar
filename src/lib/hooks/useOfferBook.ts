import { useState, useEffect, useCallback, useRef } from 'react'

export type Offer = {
    price: string
    amount: string
    seller: string
    buying: any
    selling: any
}

type Asset = { code: string; issuer: string } | 'XLM'

type Options = {
    horizonUrl?: string
    limit?: number
    pollIntervalMs?: number | null
}

type ReturnType = {
    bids: Offer[]
    asks: Offer[]
    loading: boolean
    refresh: () => Promise<void>
    stopPolling: () => void
    error: Error | null
}

/**
 * Hook to query Horizon's orderbook endpoint for a buying/selling pair.
 */
export function useOfferBook(
    buying: Asset,
    selling: Asset,
    opts: Options = {}
): ReturnType {
    const {
        horizonUrl = 'https://horizon.stellar.org',
        limit = 20,
        pollIntervalMs = null,
    } = opts

    const [bids, setBids] = useState<Offer[]>([])
    const [asks, setAsks] = useState<Offer[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)
    const pollTimer = useRef<NodeJS.Timeout | null>(null)

    const toAssetParams = (asset: Asset) =>
        asset === 'XLM'
            ? { asset_type: 'native' }
            : { asset_type: 'credit_alphanum4', asset_code: asset.code, asset_issuer: asset.issuer }

    const fetchOrderbook = useCallback(async () => {
        setLoading(true)
        try {
            const buyParams = toAssetParams(buying)
            const sellParams = toAssetParams(selling)

            const search = new URLSearchParams({
                ...Object.fromEntries(Object.entries(buyParams).map(([k, v]) => [`buying_${k}`, v])),
                ...Object.fromEntries(Object.entries(sellParams).map(([k, v]) => [`selling_${k}`, v])),
                limit: String(limit),
            })

            const res = await fetch(`${horizonUrl}/order_book?${search.toString()}`)
            if (!res.ok) throw new Error(`Horizon error ${res.status}`)
            const data = await res.json()

            const mapOffer = (o: any): Offer => ({
                price: o.price,
                amount: o.amount,
                seller: o.seller || '', // Horizon includes seller only for some calls
                buying,
                selling,
            })

            setBids((data.bids || []).map(mapOffer))
            setAsks((data.asks || []).map(mapOffer))
            setError(null)
        } catch (err) {
            setError(err as Error)
        } finally {
            setLoading(false)
        }
    }, [buying, selling, horizonUrl, limit])

    const refresh = useCallback(async () => { await fetchOrderbook() }, [fetchOrderbook])
    const stopPolling = useCallback(() => {
        if (pollTimer.current) {
            clearInterval(pollTimer.current)
            pollTimer.current = null
        }
    }, [])

    useEffect(() => {
        fetchOrderbook()
        if (pollIntervalMs) {
            pollTimer.current = setInterval(fetchOrderbook, pollIntervalMs)
        }
        return () => stopPolling()
    }, [fetchOrderbook, pollIntervalMs, stopPolling])

    return { bids, asks, loading, refresh, stopPolling, error }
}
