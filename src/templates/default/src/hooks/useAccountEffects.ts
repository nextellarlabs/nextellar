'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Horizon, Networks } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';
import { useHorizonStreaming } from './useHorizonStreaming';

/**
 * Common fields shared by all Horizon account effect records.
 */
export interface AccountEffectBase {
  id: string;
  paging_token: string;
  account: string;
  type: string;
  type_i: number;
  created_at: string;
}

export interface AccountCreatedEffect extends AccountEffectBase {
  type: 'account_created';
  starting_balance: string;
}

export interface AccountCreditedEffect extends AccountEffectBase {
  type: 'account_credited';
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  amount: string;
}

export interface AccountDebitedEffect extends AccountEffectBase {
  type: 'account_debited';
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  amount: string;
}

export interface TradeEffect extends AccountEffectBase {
  type: 'trade';
  seller: string;
  offer_id: string;
  sold_amount: string;
  sold_asset_type: string;
  sold_asset_code?: string;
  sold_asset_issuer?: string;
  bought_amount: string;
  bought_asset_type: string;
  bought_asset_code?: string;
  bought_asset_issuer?: string;
}

export interface TrustlineCreatedEffect extends AccountEffectBase {
  type: 'trustline_created';
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  limit: string;
}

export interface TrustlineRemovedEffect extends AccountEffectBase {
  type: 'trustline_removed';
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  limit: string;
}

export interface TrustlineUpdatedEffect extends AccountEffectBase {
  type: 'trustline_updated';
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  limit: string;
}

export interface TrustlineFlagsUpdatedEffect extends AccountEffectBase {
  type: 'trustline_flags_updated';
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  trustor: string;
  authorized_flag?: boolean;
  authorized_to_maintain_liabilities_flag?: boolean;
  clawback_enabled_flag?: boolean;
}

export interface SignerCreatedEffect extends AccountEffectBase {
  type: 'signer_created';
  weight: number;
  public_key: string;
  key: string;
}

export interface SignerRemovedEffect extends AccountEffectBase {
  type: 'signer_removed';
  weight: number;
  public_key: string;
  key: string;
}

export interface SignerUpdatedEffect extends AccountEffectBase {
  type: 'signer_updated';
  weight: number;
  public_key: string;
  key: string;
}

export interface AccountThresholdsUpdatedEffect extends AccountEffectBase {
  type: 'account_thresholds_updated';
  low_threshold: number;
  med_threshold: number;
  high_threshold: number;
}

export interface AccountFlagsUpdatedEffect extends AccountEffectBase {
  type: 'account_flags_updated';
  auth_required_flag?: boolean;
  auth_revocable_flag?: boolean;
  auth_immutable_flag?: boolean;
}

/**
 * Discriminated union of the most common Stellar Horizon account effect types.
 */
export type KnownAccountEffect =
  | AccountCreatedEffect
  | AccountCreditedEffect
  | AccountDebitedEffect
  | TradeEffect
  | TrustlineCreatedEffect
  | TrustlineRemovedEffect
  | TrustlineUpdatedEffect
  | TrustlineFlagsUpdatedEffect
  | SignerCreatedEffect
  | SignerRemovedEffect
  | SignerUpdatedEffect
  | AccountThresholdsUpdatedEffect
  | AccountFlagsUpdatedEffect;

/**
 * Fallback type for other Horizon effect types not explicitly modeled above.
 */
export type UnknownAccountEffect = AccountEffectBase & Record<string, unknown>;

/**
 * Union representing any Horizon effect record returned by `useAccountEffects`.
 */
export type AccountEffect = KnownAccountEffect | UnknownAccountEffect;

/**
 * Options for the `useAccountEffects` hook.
 */
export interface UseAccountEffectsOptions {
  horizonUrl?: string;
  network?: 'TESTNET' | 'PUBLIC';
  pageSize?: number;
  order?: 'asc' | 'desc';
  /** When true, subscribe to Horizon SSE effects stream and refresh on live events. */
  enableStreaming?: boolean;
  /** Poll interval fallback when streaming is unavailable (ms). */
  pollIntervalMs?: number;
}

/**
 * Return type for the `useAccountEffects` hook.
 */
export interface AccountEffectsState {
  effects: AccountEffect[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  streaming: boolean;
  polling: boolean;
  networkPassphrase: string;
  fetchNextPage: () => Promise<void>;
  refresh: () => Promise<void>;
  stopStreaming: () => void;
}

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_NETWORK: 'TESTNET' | 'PUBLIC' = 'TESTNET';
const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_ORDER: 'asc' | 'desc' = 'desc';
const MAX_ITEMS_IN_MEMORY = 1000;

/**
 * Custom React hook for fetching, paginating, and optionally streaming
 * Stellar account effects (trades, trustline changes, signer changes, credits/debits).
 *
 * @param publicKey - Stellar public key (`G...`) to fetch effects for (optional)
 * @param options - Configuration options including Horizon URL, network, page size, and streaming
 */
export function useAccountEffects(
  publicKey?: string | null,
  options: UseAccountEffectsOptions = {},
): AccountEffectsState {
  const providerConfig = useWalletConfig();
  const {
    horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL,
    network = DEFAULT_NETWORK,
    pageSize = DEFAULT_PAGE_SIZE,
    order = DEFAULT_ORDER,
    enableStreaming = false,
    pollIntervalMs,
  } = options;

  const networkPassphrase =
    network === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;

  const [effects, setEffects] = useState<AccountEffect[]>([]);
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

  const fetchAccountEffects = useCallback(
    async (
      key: string,
      cursor?: string | null,
    ): Promise<{ records: AccountEffect[]; next: string | null }> => {
      if (!serverRef.current) {
        throw new Error('Horizon server not initialized');
      }

      if (!isValidPublicKey(key)) {
        throw new Error('Invalid Stellar public key format');
      }

      try {
        let builder = serverRef.current
          .effects()
          .forAccount(key)
          .order(order)
          .limit(pageSize);

        if (cursor) {
          builder = builder.cursor(cursor);
        }

        const response = await builder.call();

        if (!response || !Array.isArray(response.records)) {
          throw new Error('Invalid response structure from Horizon');
        }

        const records = response.records as unknown as AccountEffect[];
        const nextCursor =
          records.length > 0
            ? (records[records.length - 1].paging_token ?? null)
            : null;

        return {
          records,
          next: nextCursor,
        };
      } catch (err: unknown) {
        const errorObj = err as {
          response?: { status?: number };
          message?: string;
          name?: string;
        };

        if (
          errorObj?.response?.status === 404 ||
          errorObj?.name === 'NotFoundError'
        ) {
          return { records: [], next: null };
        }

        if (
          errorObj?.message?.includes('fetch') ||
          (errorObj.response?.status && errorObj.response.status >= 500)
        ) {
          throw new Error(
            `Network error: ${errorObj.message || 'Failed to connect to Horizon'}`,
          );
        }

        if (
          errorObj.response?.status &&
          errorObj.response.status >= 400 &&
          errorObj.response.status < 500
        ) {
          console.error('Horizon client error details:', {
            status: errorObj.response.status,
            message: errorObj.message,
            publicKey: key,
            horizonUrl: lastHorizonUrlRef.current,
          });
          throw new Error(
            `Client error: ${errorObj.message || 'Invalid request to Horizon'} (Status: ${errorObj.response.status})`,
          );
        }

        throw err instanceof Error
          ? err
          : new Error('Unknown error fetching account effects');
      }
    },
    [isValidPublicKey, order, pageSize],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!publicKey) {
      setEffects([]);
      setLoading(false);
      setError(null);
      setHasMore(true);
      nextCursorRef.current = null;
      return;
    }

    if (isRequestInFlightRef.current) {
      return;
    }

    if (typeof window === 'undefined') {
      setError(new Error('Browser environment required'));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    isRequestInFlightRef.current = true;

    try {
      const result = await fetchAccountEffects(publicKey, null);
      setEffects(result.records);
      nextCursorRef.current = result.next;
      setHasMore(result.records.length === pageSize && !!result.next);
      setError(null);
      currentPublicKeyRef.current = publicKey;
    } catch (err) {
      const nextError =
        err instanceof Error ? err : new Error('Failed to fetch account effects');
      setError(nextError);
      console.error('Error fetching account effects:', nextError);
    } finally {
      setLoading(false);
      isRequestInFlightRef.current = false;
    }
  }, [publicKey, fetchAccountEffects, pageSize]);

  const {
    streaming,
    polling,
    stop: stopStreaming,
  } = useHorizonStreaming(publicKey, refresh, {
    horizonUrl,
    enabled: enableStreaming,
    streamType: 'effects',
    pollIntervalMs,
  });

  const fetchNextPage = useCallback(async (): Promise<void> => {
    if (!publicKey || !hasMore || !nextCursorRef.current) {
      return;
    }

    if (isRequestInFlightRef.current) {
      return;
    }

    if (typeof window === 'undefined') {
      setError(new Error('Browser environment required'));
      return;
    }

    setLoading(true);
    setError(null);
    isRequestInFlightRef.current = true;

    try {
      const result = await fetchAccountEffects(publicKey, nextCursorRef.current);

      setEffects((prevEffects) => {
        const seenTokens = new Set(
          prevEffects.map((item) => item.paging_token ?? item.id),
        );
        const newRecords = result.records.filter(
          (record) => !seenTokens.has(record.paging_token ?? record.id),
        );
        const combined = [...prevEffects, ...newRecords];

        if (combined.length > MAX_ITEMS_IN_MEMORY) {
          console.warn(
            `Account effects trimmed to ${MAX_ITEMS_IN_MEMORY} items to prevent excessive memory usage`,
          );
          return combined.slice(-MAX_ITEMS_IN_MEMORY);
        }

        return combined;
      });

      nextCursorRef.current = result.next;
      setHasMore(result.records.length === pageSize && !!result.next);
      setError(null);
    } catch (err) {
      const nextError =
        err instanceof Error ? err : new Error('Failed to fetch next page');
      setError(nextError);
      console.error('Error fetching next page of account effects:', nextError);
    } finally {
      setLoading(false);
      isRequestInFlightRef.current = false;
    }
  }, [publicKey, hasMore, fetchAccountEffects, pageSize]);

  useEffect(() => {
    setError(null);

    if (currentPublicKeyRef.current !== publicKey) {
      nextCursorRef.current = null;
      setHasMore(true);
      setEffects([]);
    }

    if (!publicKey) {
      setEffects([]);
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
  }, [order, pageSize, horizonUrl, publicKey, refresh]);

  return {
    effects,
    loading,
    error,
    hasMore,
    streaming,
    polling,
    networkPassphrase,
    fetchNextPage,
    refresh,
    stopStreaming,
  };
}
