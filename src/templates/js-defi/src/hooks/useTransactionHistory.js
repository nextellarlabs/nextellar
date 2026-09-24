'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import { Horizon } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';
// Default configuration
const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_TYPE = 'operations';
// Maximum items to keep in memory (prevents excessive memory usage)
const MAX_ITEMS_IN_MEMORY = 1000;
// Module-level request coordination to prevent duplicate requests
let globalRefreshInFlight = false;
let globalFetchNextInFlight = false;
/**
 * Custom React hook for fetching and paginating Stellar transaction history
 *
 * Provides paginated access to account operations or payments from Stellar Horizon.
 * Supports next page fetching, refresh, and memory management for large datasets.
 *
 * @param publicKey - Stellar public key to fetch history for (optional)
 * @param options - Configuration options including Horizon URL, page size, and type
 *
 * @example
 * ```tsx
 * function TransactionHistory({ publicKey }: { publicKey?: string }) {
 *   const { items, loading, error, fetchNextPage, refresh, hasMore } = useTransactionHistory(publicKey, {
 *     horizonUrl: 'https://horizon.stellar.org',
 *     pageSize: 20,
 *     type: 'payments'
 *   });
 *
 *   if (loading && items.length === 0) return <div>Loading transaction history...</div>;
 *   if (error) return <div>Error: {error.message} <button onClick={refresh}>Retry</button></div>;
 *
 *   return (
 *     <div>
 *       <h3>Transaction History</h3>
 *       <button onClick={refresh} disabled={loading}>Refresh</button>
 *
 *       {items.length === 0 ? (
 *         <p>No transactions found.</p>
 *       ) : (
 *         <>
 *           {items.map((item, index) => (
 *             <div key={item.id || index}>
 *               <strong>{item.type_i === 1 ? 'Payment' : 'Operation'}</strong>
 *               : {item.amount || 'N/A'} - {new Date(item.created_at).toLocaleDateString()}
 *             </div>
 *           ))}
 *
 *           {hasMore && (
 *             <button onClick={fetchNextPage} disabled={loading}>
 *               {loading ? 'Loading...' : 'Load More'}
 *             </button>
 *           )}
 *         </>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useTransactionHistory(publicKey, options = {}) {
    // Auto-consume provider config as fallback
    const providerConfig = useWalletConfig();
    const { horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL, pageSize = DEFAULT_PAGE_SIZE, type = DEFAULT_TYPE } = options;
    // State management
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [hasMore, setHasMore] = useState(true);
    // Refs for cleanup and instance management
    const serverRef = useRef(null);
    const lastHorizonUrlRef = useRef('');
    const nextCursorRef = useRef(null);
    const isRequestInFlightRef = useRef(false);
    const currentPublicKeyRef = useRef(null);
    // Initialize Horizon server instance when URL changes
    useEffect(() => {
        if (lastHorizonUrlRef.current !== horizonUrl) {
            try {
                serverRef.current = new Horizon.Server(horizonUrl);
                lastHorizonUrlRef.current = horizonUrl;
            }
            catch (err) {
                console.error('Failed to initialize Horizon server:', err);
                setError(new Error(`Invalid Horizon URL: ${horizonUrl}`));
            }
        }
    }, [horizonUrl]);
    /**
     * Validate Stellar public key format
     */
    const isValidPublicKey = useCallback((key) => {
        return key.length === 56 && key.startsWith('G');
    }, []);
    /**
     * Fetch transaction history for the given public key and cursor
     */
    const fetchTransactionHistory = useCallback(async (key, cursor) => {
        if (!serverRef.current) {
            throw new Error('Horizon server not initialized');
        }
        if (!isValidPublicKey(key)) {
            throw new Error('Invalid Stellar public key format');
        }
        try {
            let builder;
            // Build the appropriate request based on type
            if (type === 'payments') {
                builder = serverRef.current
                    .payments()
                    .forAccount(key)
                    .order('desc')
                    .limit(pageSize);
            }
            else {
                builder = serverRef.current
                    .operations()
                    .forAccount(key)
                    .order('desc')
                    .limit(pageSize);
            }
            // Add cursor for pagination if provided
            if (cursor) {
                builder = builder.cursor(cursor);
            }
            const response = await builder.call();
            // Validate response structure
            if (!response || !Array.isArray(response.records)) {
                throw new Error('Invalid response structure from Horizon');
            }
            // Extract next cursor from the response
            const nextCursor = response.records.length > 0
                ? response.records[response.records.length - 1].paging_token
                : null;
            return {
                records: response.records,
                next: nextCursor
            };
        }
        catch (err) {
            const errorObj = err;
            // Handle specific error cases
            if (errorObj?.response?.status === 404 || errorObj?.name === 'NotFoundError') {
                // Account doesn't exist on network (needs funding) - return empty results
                return { records: [], next: null };
            }
            // Network or server errors
            if (errorObj?.message?.includes('fetch') || (errorObj.response?.status && errorObj.response.status >= 500)) {
                throw new Error(`Network error: ${errorObj.message || 'Failed to connect to Horizon'}`);
            }
            // Client errors (400-499)
            if (errorObj.response?.status && errorObj.response.status >= 400 && errorObj.response.status < 500) {
                console.error('Horizon client error details:', {
                    status: errorObj.response.status,
                    message: errorObj.message,
                    publicKey: key,
                    horizonUrl: lastHorizonUrlRef.current,
                    type
                });
                throw new Error(`Client error: ${errorObj.message || 'Invalid request to Horizon'} (Status: ${errorObj.response.status})`);
            }
            // Re-throw with more context
            throw err instanceof Error ? err : new Error('Unknown error fetching transaction history');
        }
    }, [isValidPublicKey, type, pageSize]);
    /**
     * Refresh transaction history from the beginning
     */
    const refresh = useCallback(async () => {
        // If no public key, clear state and return
        if (!publicKey) {
            setItems([]);
            setLoading(false);
            setError(null);
            setHasMore(true);
            nextCursorRef.current = null;
            return;
        }
        // Prevent duplicate refresh requests
        if (globalRefreshInFlight || isRequestInFlightRef.current) {
            return;
        }
        // Browser environment check
        if (typeof window === 'undefined') {
            setError(new Error('Browser environment required'));
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        globalRefreshInFlight = true;
        isRequestInFlightRef.current = true;
        try {
            const result = await fetchTransactionHistory(publicKey, null);
            setItems(result.records);
            nextCursorRef.current = result.next;
            setHasMore(result.records.length === pageSize && !!result.next);
            setError(null);
            currentPublicKeyRef.current = publicKey;
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error('Failed to fetch transaction history');
            setError(error);
            console.error('Error fetching transaction history:', error);
            // Keep previous items on error (don't wipe them)
        }
        finally {
            setLoading(false);
            globalRefreshInFlight = false;
            isRequestInFlightRef.current = false;
        }
    }, [publicKey, fetchTransactionHistory, pageSize]);
    /**
     * Fetch the next page of transaction history
     */
    const fetchNextPage = useCallback(async () => {
        // If no public key or no more items, return early
        if (!publicKey || !hasMore || !nextCursorRef.current) {
            return;
        }
        // Prevent duplicate fetch requests
        if (globalFetchNextInFlight || isRequestInFlightRef.current) {
            return;
        }
        // Browser environment check
        if (typeof window === 'undefined') {
            setError(new Error('Browser environment required'));
            return;
        }
        setLoading(true);
        setError(null);
        globalFetchNextInFlight = true;
        isRequestInFlightRef.current = true;
        try {
            const result = await fetchTransactionHistory(publicKey, nextCursorRef.current);
            setItems(prevItems => {
                const newItems = [...prevItems, ...result.records];
                // Memory management: limit total items in memory
                if (newItems.length > MAX_ITEMS_IN_MEMORY) {
                    const trimmedItems = newItems.slice(-MAX_ITEMS_IN_MEMORY);
                    console.warn(`Transaction history trimmed to ${MAX_ITEMS_IN_MEMORY} items to prevent excessive memory usage`);
                    return trimmedItems;
                }
                return newItems;
            });
            nextCursorRef.current = result.next;
            setHasMore(result.records.length === pageSize && !!result.next);
            setError(null);
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error('Failed to fetch next page');
            setError(error);
            console.error('Error fetching next page:', error);
        }
        finally {
            setLoading(false);
            globalFetchNextInFlight = false;
            isRequestInFlightRef.current = false;
        }
    }, [publicKey, hasMore, fetchTransactionHistory, pageSize]);
    // Effect to handle publicKey changes and initial load
    useEffect(() => {
        // Clear error state when publicKey changes
        setError(null);
        // Reset pagination state when publicKey changes
        if (currentPublicKeyRef.current !== publicKey) {
            nextCursorRef.current = null;
            setHasMore(true);
            setItems([]);
        }
        if (!publicKey) {
            setItems([]);
            setLoading(false);
            setError(null);
            setHasMore(true);
            nextCursorRef.current = null;
            currentPublicKeyRef.current = null;
            return;
        }
        // Initial load
        refresh();
    }, [publicKey, refresh]);
    // Effect to handle options changes (type, pageSize, horizonUrl)
    useEffect(() => {
        // If we have a publicKey and the options changed, refresh
        if (publicKey && currentPublicKeyRef.current === publicKey) {
            // Reset state and refresh with new options
            nextCursorRef.current = null;
            setHasMore(true);
            refresh();
        }
    }, [type, pageSize, horizonUrl, publicKey, refresh]);
    // Cleanup on unmount
    useEffect(() => {
        return () => {
            // Reset global state on unmount
            if (isRequestInFlightRef.current) {
                globalRefreshInFlight = false;
                globalFetchNextInFlight = false;
                isRequestInFlightRef.current = false;
            }
        };
    }, []);
    return {
        items,
        loading,
        error,
        fetchNextPage,
        refresh,
        hasMore,
    };
}
