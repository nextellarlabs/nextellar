'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Horizon, StrKey } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';

export type TypedAsset = {
  code: string;
  issuer?: string;
  type: string;
};

/**
 * Decoded and typed Stellar account operation record
 */
export interface DecodedOperation {
  id: string;
  paging_token: string;
  type: string;
  type_i: number;
  created_at: string;
  transaction_hash: string;
  source_account: string;
  successful: boolean;
  /** Human-readable amount (for payments, create_account starting balance, offers, etc.) */
  amount?: string;
  /** Primary asset associated with the operation */
  asset?: TypedAsset;
  /** Source amount for path payments */
  sourceAmount?: string;
  /** Source asset for path payments */
  sourceAsset?: TypedAsset;
  /** Initial balance for create_account operations */
  startingBalance?: string;
  /** Trust limit for change_trust operations */
  limit?: string;
  /** Recipient / destination / counterparty / sponsor account */
  counterparty?: string;
  /** Raw unparsed Horizon operation record */
  raw: Horizon.ServerApi.OperationRecord;
}

export interface UseAccountOperationsOptions {
  horizonUrl?: string;
  pageSize?: number;
  order?: 'asc' | 'desc';
  typeFilter?: string | string[];
  network?: 'TESTNET' | 'PUBLIC';
  networkPassphrase?: string;
}

export interface AccountOperationsState {
  operations: DecodedOperation[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  nextCursor: string | null;
  prevCursor: string | null;
  fetchNextPage: () => Promise<void>;
  fetchPreviousPage: () => Promise<void>;
  refresh: () => Promise<void>;
  setFilter: (filter?: string | string[]) => void;
}

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_ORDER = 'desc';

/**
 * Helper to decode asset objects from Horizon operation records
 */
function decodeAsset(record: Record<string, any>, prefix = ''): TypedAsset | undefined {
  const assetType = record[`${prefix}asset_type`];
  if (!assetType) return undefined;

  if (assetType === 'native') {
    return { code: 'XLM', type: 'native' };
  }

  const code = record[`${prefix}asset_code`] || '';
  const issuer = record[`${prefix}asset_issuer`] || undefined;
  return { code, issuer, type: assetType };
}

/**
 * Decodes raw Horizon operation record into a strongly-typed DecodedOperation
 */
export function decodeOperationRecord(
  record: Horizon.ServerApi.OperationRecord,
  accountPublicKey?: string | null
): DecodedOperation {
  const rec = record as Record<string, any>;
  const decoded: DecodedOperation = {
    id: record.id,
    paging_token: record.paging_token,
    type: record.type,
    type_i: record.type_i,
    created_at: record.created_at,
    transaction_hash: record.transaction_hash,
    source_account: record.source_account,
    successful: record.transaction_successful !== false,
    raw: record,
  };

  switch (record.type) {
    case 'payment':
      decoded.amount = rec.amount;
      decoded.asset = decodeAsset(rec);
      decoded.counterparty = rec.to === accountPublicKey ? rec.from : rec.to;
      break;

    case 'create_account':
      decoded.amount = rec.starting_balance;
      decoded.startingBalance = rec.starting_balance;
      decoded.asset = { code: 'XLM', type: 'native' };
      decoded.counterparty = rec.account;
      break;

    case 'path_payment_strict_send':
    case 'path_payment_strict_receive':
      decoded.amount = rec.amount;
      decoded.asset = decodeAsset(rec);
      decoded.sourceAmount = rec.source_amount;
      decoded.sourceAsset = decodeAsset(rec, 'source_');
      decoded.counterparty = rec.to;
      break;

    case 'change_trust':
      decoded.asset = decodeAsset(rec);
      decoded.amount = rec.limit;
      decoded.limit = rec.limit;
      break;

    case 'manage_buy_offer':
    case 'manage_sell_offer':
    case 'create_passive_sell_offer':
      decoded.amount = rec.amount;
      decoded.asset = decodeAsset(rec, 'buying_');
      decoded.sourceAsset = decodeAsset(rec, 'selling_');
      break;

    case 'account_merge':
      decoded.counterparty = rec.into;
      break;

    case 'begin_sponsoring_future_reserves':
      decoded.counterparty = rec.sponsored_id;
      break;

    case 'create_claimable_balance':
      decoded.amount = rec.amount;
      decoded.asset = decodeAsset(rec);
      break;

    default:
      if (rec.amount) decoded.amount = rec.amount;
      if (rec.asset_type) decoded.asset = decodeAsset(rec);
      if (rec.to) decoded.counterparty = rec.to;
      else if (rec.account) decoded.counterparty = rec.account;
      break;
  }

  return decoded;
}

/**
 * Custom React hook for paginated, filterable account operations with typed decoding.
 *
 * @param publicKey - Stellar public key (G... or M...)
 * @param options - Configuration including Horizon URL, page size, order, and operation type filter.
 */
export function useAccountOperations(
  publicKey?: string | null,
  options: UseAccountOperationsOptions = {}
): AccountOperationsState {
  const providerConfig = useWalletConfig();
  const {
    horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL,
    pageSize = DEFAULT_PAGE_SIZE,
    order = DEFAULT_ORDER,
    typeFilter: initialFilter,
  } = options;

  const [operations, setOperations] = useState<DecodedOperation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [prevCursor, setPrevCursor] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | string[] | undefined>(initialFilter);

  const serverRef = useRef<Horizon.Server | null>(null);
  const lastHorizonUrlRef = useRef<string>('');
  const cursorHistoryRef = useRef<string[]>([]);
  const currentCursorIndexRef = useRef<number>(-1);

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
    if (!key || typeof key !== 'string') return false;
    return (
      StrKey.isValidEd25519PublicKey(key) ||
      (typeof StrKey.isValidMed25519PublicKey === 'function' && StrKey.isValidMed25519PublicKey(key))
    );
  }, []);

  const matchesFilter = useCallback(
    (opType: string, filter?: string | string[]): boolean => {
      if (!filter) return true;
      if (Array.isArray(filter)) {
        return filter.includes(opType);
      }
      return opType === filter;
    },
    []
  );

  const fetchPage = useCallback(
    async (cursor?: string | null, filterOverride?: string | string[]): Promise<void> => {
      if (!publicKey) {
        setOperations([]);
        setLoading(false);
        setError(null);
        setHasMore(false);
        return;
      }

      if (!isValidPublicKey(publicKey)) {
        const err = new Error(`Invalid Stellar address format: ${publicKey}`);
        setError(err);
        setOperations([]);
        setLoading(false);
        return;
      }

      if (!serverRef.current) {
        const err = new Error('Horizon server not initialized');
        setError(err);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        let builder = serverRef.current
          .operations()
          .forAccount(publicKey)
          .order(order)
          .limit(pageSize);

        if (cursor) {
          builder = builder.cursor(cursor);
        }

        const response = await builder.call();
        const records = response?.records || [];

        const effectiveFilter = filterOverride !== undefined ? filterOverride : activeFilter;
        const decoded = records
          .map((r) => decodeOperationRecord(r, publicKey))
          .filter((op) => matchesFilter(op.type, effectiveFilter));

        setOperations(decoded);

        if (records.length > 0) {
          const lastToken = records[records.length - 1].paging_token;
          const firstToken = records[0].paging_token;
          setNextCursor(lastToken);
          setPrevCursor(firstToken);
          setHasMore(records.length >= pageSize);
        } else {
          setNextCursor(null);
          setHasMore(false);
        }
      } catch (err: unknown) {
        const errObj = err as { response?: { status?: number }; message?: string; name?: string };

        if (errObj?.response?.status === 404 || errObj?.name === 'NotFoundError') {
          // Account unfunded or not found: clean empty state
          setOperations([]);
          setHasMore(false);
          setNextCursor(null);
          setPrevCursor(null);
        } else if (errObj?.response?.status && errObj.response.status >= 500) {
          const error = new Error(`Network error: ${errObj.message || 'Failed to connect to Horizon'}`);
          setError(error);
          setOperations([]);
        } else if (errObj?.response?.status && errObj.response.status >= 400 && errObj.response.status < 500) {
          const error = new Error(
            `Client error: ${errObj.message || 'Invalid request to Horizon'} (Status: ${errObj.response.status})`
          );
          setError(error);
          setOperations([]);
        } else {
          const error = err instanceof Error ? err : new Error(String(err));
          setError(error);
          setOperations([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [publicKey, isValidPublicKey, order, pageSize, activeFilter, matchesFilter]
  );

  // Initial fetch and fetch on publicKey or activeFilter changes
  useEffect(() => {
    cursorHistoryRef.current = [];
    currentCursorIndexRef.current = -1;
    fetchPage(null);
  }, [fetchPage]);

  const fetchNextPage = useCallback(async (): Promise<void> => {
    if (!nextCursor || !hasMore || loading) return;
    cursorHistoryRef.current.push(nextCursor);
    currentCursorIndexRef.current += 1;
    await fetchPage(nextCursor);
  }, [nextCursor, hasMore, loading, fetchPage]);

  const fetchPreviousPage = useCallback(async (): Promise<void> => {
    if (loading || currentCursorIndexRef.current < 0) return;
    currentCursorIndexRef.current -= 1;
    const targetCursor =
      currentCursorIndexRef.current >= 0
        ? cursorHistoryRef.current[currentCursorIndexRef.current]
        : null;
    await fetchPage(targetCursor);
  }, [loading, fetchPage]);

  const refresh = useCallback(async (): Promise<void> => {
    cursorHistoryRef.current = [];
    currentCursorIndexRef.current = -1;
    await fetchPage(null);
  }, [fetchPage]);

  const setFilter = useCallback(
    (newFilter?: string | string[]): void => {
      setActiveFilter(newFilter);
      cursorHistoryRef.current = [];
      currentCursorIndexRef.current = -1;
      fetchPage(null, newFilter);
    },
    [fetchPage]
  );

  return {
    operations,
    loading,
    error,
    hasMore,
    nextCursor,
    prevCursor,
    fetchNextPage,
    fetchPreviousPage,
    refresh,
    setFilter,
  };
}
