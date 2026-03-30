import { useState, useEffect, useCallback, useRef } from 'react';
import { useWalletConfig } from '../contexts';
/**
 * Hook to query Horizon's orderbook endpoint for a buying/selling pair.
 */
export function useOfferBook(buying, selling, opts = {}) {
    // Auto-consume provider config as fallback
    const providerConfig = useWalletConfig();
    const { horizonUrl = providerConfig?.horizonUrl ?? 'https://horizon.stellar.org', limit = 20, pollIntervalMs = null, } = opts;
    const [bids, setBids] = useState([]);
    const [asks, setAsks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const pollTimer = useRef(null);
    const toAssetParams = (asset) => asset === 'XLM'
        ? { asset_type: 'native' }
        : { asset_type: 'credit_alphanum4', asset_code: asset.code, asset_issuer: asset.issuer };
    const fetchOrderbook = useCallback(async () => {
        setLoading(true);
        try {
            const buyParams = toAssetParams(buying);
            const sellParams = toAssetParams(selling);
            const search = new URLSearchParams({
                ...Object.fromEntries(Object.entries(buyParams).map(([k, v]) => [`buying_${k}`, v])),
                ...Object.fromEntries(Object.entries(sellParams).map(([k, v]) => [`selling_${k}`, v])),
                limit: String(limit),
            });
            const res = await fetch(`${horizonUrl}/order_book?${search.toString()}`);
            if (!res.ok)
                throw new Error(`Horizon error ${res.status}`);
            const data = await res.json();
            const mapOffer = (o) => ({
                price: o.price,
                amount: o.amount,
                seller: o.seller || '', // Horizon includes seller only for some calls
                buying,
                selling,
            });
            setBids((data.bids || []).map(mapOffer));
            setAsks((data.asks || []).map(mapOffer));
            setError(null);
        }
        catch (err) {
            setError(err);
        }
        finally {
            setLoading(false);
        }
    }, [buying, selling, horizonUrl, limit]);
    const refresh = useCallback(async () => { await fetchOrderbook(); }, [fetchOrderbook]);
    const stopPolling = useCallback(() => {
        if (pollTimer.current) {
            clearInterval(pollTimer.current);
            pollTimer.current = null;
        }
    }, []);
    useEffect(() => {
        fetchOrderbook();
        if (pollIntervalMs) {
            pollTimer.current = setInterval(fetchOrderbook, pollIntervalMs);
        }
        return () => stopPolling();
    }, [fetchOrderbook, pollIntervalMs, stopPolling]);
    return { bids, asks, loading, refresh, stopPolling, error };
}
