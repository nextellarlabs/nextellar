'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Horizon } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';

/**
 * Operation item type
 */
export type OperationItem = Horizon.ServerApi.OperationRecord;

/**
 * Options for the useTransactionHistory hook
 */
export interface UseTransactionHistoryOptions {
  horizonUrl?: string;
  pageSize?: number;
  type?: 'payments' | 'operations';
}

/**
 * Return type for the useTransactionHistory hook
 */
export interface TransactionHistoryState {
  items: OperationItem[];
  loading: boolean;
  error?: Error | null;
  fetchNextPage: () => Promise<void>;
  refresh: () => Promise<void>;
  hasMore: boolean;
}

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_TYPE = 'operations';
const MAX_ITEMS_IN_MEMORY = 1000;

let globalRefreshInFlight = false;
let globalFetchNextInFlight = false;

/**
 * Custom React hook for fetching and paginating Stellar transaction history.
 *
 * @param publicKey - Stellar public key to fetch history for (optional)
 * @param options - Configuration options including Horizon URL, page size, and type
 *
 * @example
 * ```tsx
 * const { items, loading, error, fetchNextPage, refresh, hasMore } =
 *   useTransactionHistory(publicKey, { pageSize: 20, type: 'payments' });
 * ```
 */
export function useTransactionHistory(
  publicKey?: string | null,
  options: UseTransactionHistoryOptions = {}
): TransactionHistoryState {
  const providerConfig = useWalletConfig();
  const {
    horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL,
    pageSize = DEFAULT_PAGE_SIZE,
    type = DEFAULT_TYPE,
  } = options;

  const [items, setItems] = useState<OperationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const serverRef = useRef<Horizon.Server | null>(null);
  const lastHorizonUrlRef = useRef<string>('');
  const nextCursorRef = useRef<string | null>(null);
  const isRequestInFlightRef = useRef(false);
  const currentPublicKeyRef = useRef<string | null>(null);

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

  const isValidPublicKey = useCallback((key: string): boolean => {
    return key.length === 56 && key.startsWith('G');
  }, []);

  const fetchTransactionHistory = useCallback(async (
    key: string,
    cursor?: string | null
  ): Promise<{ records: OperationItem[]; next: string | null }> => {
    if (!serverRef.current) throw new Error('Horizon server not initialized');
    if (!isValidPublicKey(key)) throw new Error('Invalid Stellar public key format');

    try {
      let builder;

      if (type === 'payments') {
        builder = serverRef.current.payments().forAccount(key).order('desc').limit(pageSize);
      } else {
        builder = serverRef.current.operations().forAccount(key).order('desc').limit(pageSize);
      }

      if (cursor) builder = builder.cursor(cursor);

      const response = await builder.call();

      if (!response || !Array.isArray(response.records)) {
        throw new Error('Invalid response structure from Horizon');
      }

      const nextCursor = response.records.length > 0
        ? response.records[response.records.length - 1].paging_token
        : null;

      return { records: response.records, next: nextCursor };
    } catch (err: unknown) {
      const errorObj = err as { response?: { status?: number }; message?: string; name?: string };
      if (errorObj?.response?.status === 404 || errorObj?.name === 'NotFoundError') {
        return { records: [], next: null };
      }
      if (errorObj?.message?.includes('fetch') || (errorObj.response?.status && errorObj.response.status >= 500)) {
        throw new Error(`Network error: ${errorObj.message || 'Failed to connect to Horizon'}`);
      }
      if (errorObj.response?.status && errorObj.response.status >= 400 && errorObj.response.status < 500) {
        throw new Error(`Client error: ${errorObj.message || 'Invalid request to Horizon'} (Status: ${errorObj.response.status})`);
      }
      throw err instanceof Error ? err : new Error('Unknown error fetching transaction history');
    }
  }, [isValidPublicKey, type, pageSize]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!publicKey) {
      setItems([]);
      setLoading(false);
      setError(null);
      setHasMore(true);
      nextCursorRef.current = null;
      return;
    }

    if (globalRefreshInFlight || isRequestInFlightRef.current) return;
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
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch transaction history');
      setError(error);
      console.error('Error fetching transaction history:', error);
    } finally {
      setLoading(false);
      globalRefreshInFlight = false;
      isRequestInFlightRef.current = false;
    }
  }, [publicKey, fetchTransactionHistory, pageSize]);

  const fetchNextPage = useCallback(async (): Promise<void> => {
    if (!publicKey || !hasMore || !nextCursorRef.current) return;
    if (globalFetchNextInFlight || isRequestInFlightRef.current) return;
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
        // De-duplicate by paging_token (falling back to id): a record at the
        // exact page boundary can be re-returned by the next page's request,
        // which would otherwise render it twice.
        const seenTokens = new Set(
          prevItems.map(item => item.paging_token ?? item.id)
        );
        const newRecords = result.records.filter(
          record => !seenTokens.has(record.paging_token ?? record.id)
        );
        const newItems = [...prevItems, ...newRecords];
        if (newItems.length > MAX_ITEMS_IN_MEMORY) {
          console.warn(`Transaction history trimmed to ${MAX_ITEMS_IN_MEMORY} items`);
          return newItems.slice(-MAX_ITEMS_IN_MEMORY);
        }
        return newItems;
      });

      nextCursorRef.current = result.next;
      setHasMore(result.records.length === pageSize && !!result.next);
      setError(null);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch next page');
      setError(error);
      console.error('Error fetching next page:', error);
    } finally {
      setLoading(false);
      globalFetchNextInFlight = false;
      isRequestInFlightRef.current = false;
    }
  }, [publicKey, hasMore, fetchTransactionHistory, pageSize]);

  useEffect(() => {
    setError(null);
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
    refresh();
  }, [publicKey, refresh]);

  useEffect(() => {
    if (publicKey && currentPublicKeyRef.current === publicKey) {
      nextCursorRef.current = null;
      setHasMore(true);
      refresh();
    }
  }, [type, pageSize, horizonUrl, publicKey, refresh]);

  useEffect(() => {
    return () => {
      if (isRequestInFlightRef.current) {
        globalRefreshInFlight = false;
        globalFetchNextInFlight = false;
        isRequestInFlightRef.current = false;
      }
    };
  }, []);

  return { items, loading, error, fetchNextPage, refresh, hasMore };
}
