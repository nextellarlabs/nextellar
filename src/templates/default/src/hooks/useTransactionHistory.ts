'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Horizon } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';
import {
  globalHorizonRateLimiter,
  HorizonRateLimitError,
  type HorizonTrafficClass,
} from '../lib/horizonRateLimiter';
import { useHorizonStreaming, type HorizonUpdateSource } from './useHorizonStreaming';

/**
 * Operation item type - initially loose, can be refined later for specific operation types
 */
export type OperationItem = Horizon.ServerApi.OperationRecord;

/**
 * Options for the useTransactionHistory hook
 */
export interface UseTransactionHistoryOptions {
  horizonUrl?: string;
  pageSize?: number;
  type?: 'payments' | 'operations';
  /** When true, subscribe to Horizon SSE and refresh on live events (#949). */
  enableStreaming?: boolean;
}

/**
 * Return type for the useTransactionHistory hook
 */
export interface TransactionHistoryState {
  items: OperationItem[];
  loading: boolean;
  error: Error | null;
  fetchNextPage: () => Promise<void>;
  refresh: () => Promise<void>;
  hasMore: boolean;
}

// Default configuration
const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_TYPE = 'operations';

// Maximum items to keep in memory (prevents excessive memory usage)
const MAX_ITEMS_IN_MEMORY = 1000;

// Module-level request coordination to prevent duplicate requests.
// Keyed by public key so two accounts never block each other, and so the
// live SSE stream and the polling loop of the same account share one
// in-flight slot instead of firing duplicate Horizon requests (#1289).
const inFlightRefreshes = new Set<string>();
const pendingRefreshes = new Set<string>();
const inFlightPageFetches = new Set<string>();

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
export function useTransactionHistory(
  publicKey?: string | null,
  options: UseTransactionHistoryOptions = {}
): TransactionHistoryState {
  // Auto-consume provider config as fallback
  const providerConfig = useWalletConfig();
  const { 
    horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL, 
    pageSize = DEFAULT_PAGE_SIZE,
    type = DEFAULT_TYPE,
    enableStreaming = false,
  } = options;
  
  // State management
  const [items, setItems] = useState<OperationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  
  // Refs for cleanup and instance management
  const serverRef = useRef<Horizon.Server | null>(null);
  const lastHorizonUrlRef = useRef<string>('');
  const nextCursorRef = useRef<string | null>(null);
  const currentPublicKeyRef = useRef<string | null>(null);
  
  // Initialize Horizon server instance when URL changes
  useEffect(() => {
    if (lastHorizonUrlRef.current !== horizonUrl) {
      try {
        serverRef.current = new Horizon.Server(horizonUrl);
        lastHorizonUrlRef.current = horizonUrl;
      } catch (err) {
        console.error('Failed to initialize Horizon server:', err);
        setError(new Error(`Invalid Horizon URL: ${horizonUrl}`));
      }
    }
  }, [horizonUrl]);

  /**
   * Validate Stellar public key format
   */
  const isValidPublicKey = useCallback((key: string): boolean => {
    return key.length === 56 && key.startsWith('G');
  }, []);

  /**
   * Fetch transaction history for the given public key and cursor
   *
   * The Horizon call goes through the shared client-side rate limiter so the
   * live stream and the polling loop spend from one budget. The request is
   * counted exactly once, in the traffic class that triggered it (#1289).
   */
  const fetchTransactionHistory = useCallback(async (
    key: string, 
    cursor?: string | null,
    trafficClass: HorizonTrafficClass = 'poll',
  ): Promise<{ records: OperationItem[]; next: string | null }> => {
    const server = serverRef.current;
    if (!server) {
      throw new Error('Horizon server not initialized');
    }

    if (!isValidPublicKey(key)) {
      throw new Error('Invalid Stellar public key format');
    }

    try {
      let builder;
      
      // Build the appropriate request based on type
      if (type === 'payments') {
        builder = server
          .payments()
          .forAccount(key)
          .order('desc')
          .limit(pageSize);
      } else {
        builder = server
          .operations()
          .forAccount(key)
          .order('desc')
          .limit(pageSize);
      }

      // Add cursor for pagination if provided
      if (cursor) {
        builder = builder.cursor(cursor);
      }

      const response = await globalHorizonRateLimiter.execute(
        () => builder.call(),
        trafficClass,
      );
      
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
    } catch (err: unknown) {
      const errorObj = err as { response?: { status?: number }; message?: string; name?: string };
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
   * Refresh transaction history from the beginning.
   *
   * `source` records what triggered the refresh so the shared rate-limit
   * budget can charge it to the right traffic class: a live stream event is
   * `stream`, a scheduled refresh is `poll` (#1289).
   */
  const runRefresh = useCallback(async (
    source: HorizonUpdateSource = 'poll',
  ): Promise<void> => {
    // If no public key, clear state and return
    if (!publicKey) {
      setItems([]);
      setLoading(false);
      setError(null);
      setHasMore(true);
      nextCursorRef.current = null;
      return;
    }

    // Browser environment check
    if (typeof window === 'undefined') {
      setError(new Error('Browser environment required'));
      setLoading(false);
      return;
    }

    // A refresh for this account is already in flight: coalesce the trigger
    // into a single follow-up request instead of dropping it, so a live
    // stream update is never swallowed by a poll (or the other way round).
    if (inFlightRefreshes.has(publicKey)) {
      pendingRefreshes.add(publicKey);
      return;
    }

    inFlightRefreshes.add(publicKey);
    setLoading(true);
    setError(null);

    try {
      do {
        pendingRefreshes.delete(publicKey);
        try {
          const result = await fetchTransactionHistory(publicKey, null, source);

          setItems(result.records);
          nextCursorRef.current = result.next;
          setHasMore(result.records.length === pageSize && !!result.next);
          setError(null);
          currentPublicKeyRef.current = publicKey;
        } catch (err) {
          if (err instanceof HorizonRateLimitError) {
            // The shared client-side guard blocked this request. That is our
            // own throttle, not a Horizon failure: keep the items we already
            // have and retry on the next tick.
            continue;
          }
          const error = err instanceof Error ? err : new Error('Failed to fetch transaction history');
          setError(error);
          console.error('Error fetching transaction history:', error);
          // Keep previous items on error (don't wipe them)
        }
      } while (pendingRefreshes.has(publicKey));
    } finally {
      inFlightRefreshes.delete(publicKey);
      pendingRefreshes.delete(publicKey);
      setLoading(false);
    }
  }, [publicKey, fetchTransactionHistory, pageSize]);

  /**
   * Public refresh entry point — always a scheduled (poll class) refresh.
   */
  const refresh = useCallback(async (): Promise<void> => {
    await runRefresh('poll');
  }, [runRefresh]);

  useHorizonStreaming(
    publicKey,
    (source) => {
      void runRefresh(source);
    },
    {
      horizonUrl,
      enabled: enableStreaming,
      streamType: type === 'payments' ? 'payments' : 'operations',
    },
  );

  /**
   * Fetch the next page of transaction history
   */
  const fetchNextPage = useCallback(async (): Promise<void> => {
    // If no public key or no more items, return early
    if (!publicKey || !hasMore || !nextCursorRef.current) {
      return;
    }

    // Prevent duplicate fetch requests for this account
    if (inFlightPageFetches.has(publicKey)) {
      return;
    }

    // Browser environment check
    if (typeof window === 'undefined') {
      setError(new Error('Browser environment required'));
      return;
    }

    setLoading(true);
    setError(null);
    inFlightPageFetches.add(publicKey);

    try {
      const result = await fetchTransactionHistory(publicKey, nextCursorRef.current, 'poll');
      
      setItems(prevItems => {
        // De-duplicate by paging_token (falling back to id): Horizon's cursor
        // is meant to be exclusive of the record it points at, but a record
        // at the exact page boundary can still come back on both the page
        // that produced the cursor and the page fetched with it — without
        // this filter that boundary record would render twice.
        const seenTokens = new Set(
          prevItems.map(item => item.paging_token ?? item.id)
        );
        const newRecords = result.records.filter(
          record => !seenTokens.has(record.paging_token ?? record.id)
        );
        const newItems = [...prevItems, ...newRecords];

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
    } catch (err) {
      if (err instanceof HorizonRateLimitError) {
        // Locally throttled by the shared guard — not a Horizon failure.
        return;
      }
      const error = err instanceof Error ? err : new Error('Failed to fetch next page');
      setError(error);
      console.error('Error fetching next page:', error);
    } finally {
      setLoading(false);
      inFlightPageFetches.delete(publicKey);
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
      // Drop any coalesced refresh for this account so a pending trigger
      // cannot fire another request after the hook is gone.
      if (publicKey) {
        pendingRefreshes.delete(publicKey);
      }
    };
  }, [publicKey]);

  return {
    items,
    loading,
    error,
    fetchNextPage,
    refresh,
    hasMore,
  };
}