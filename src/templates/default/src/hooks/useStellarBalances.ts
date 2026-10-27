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
 * Balance interface matching Stellar Horizon API format
 */
export type Balance = {
  asset_type: string;         // e.g., 'native' or 'credit_alphanum4'
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  limit?: string;
};

/**
 * Options for the useStellarBalances hook
 */
export interface UseStellarBalancesOptions {
  horizonUrl?: string;
  pollIntervalMs?: number | null;
  /** When true, subscribe to Horizon SSE and refresh on live payment events (#949). */
  enableStreaming?: boolean;
}

/**
 * Return type for the useStellarBalances hook
 */
export interface StellarBalancesState {
  balances: Balance[];
  loading: boolean;
  error?: Error | null;
  refresh: () => Promise<void>;
  stopPolling: () => void;
}

// Minimum polling interval safeguard (5 seconds)
const MIN_POLL_INTERVAL = 5000;
// Default Horizon URLs
const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';

/**
 * Module-level request coordination to prevent duplicate requests.
 *
 * Keyed by public key so two different accounts never block each other, and
 * so the live SSE stream and the polling loop of the *same* account share a
 * single in-flight slot instead of firing duplicate Horizon requests
 * (#1289). A trigger that arrives while a request is in flight is coalesced
 * into one follow-up request rather than dropped — dropping it would let a
 * poll swallow a live stream update (or the other way round).
 */
const inFlightRequests = new Set<string>();
const pendingRequests = new Set<string>();

/**
 * Custom React hook for fetching and managing Stellar account balances
 *
 * Provides typed balance objects, optional polling, and handles account absence gracefully.
 * Designed to be fast, safe, and suitable for UI components and dashboards.
 *
 * @param publicKey - Stellar public key to fetch balances for (optional)
 * @param options - Configuration options including Horizon URL and polling interval
 *
 * @example
 * ```tsx
 * function WalletBalance({ publicKey }: { publicKey?: string }) {
 *   const { balances, loading, error, refresh, stopPolling } = useStellarBalances(publicKey, {
 *     horizonUrl: 'https://horizon.stellar.org',
 *     pollIntervalMs: 10000 // Poll every 10 seconds
 *   });
 *
 *   if (loading) return <div>Loading balances...</div>;
 *   if (error) return <div>Error: {error.message} <button onClick={refresh}>Retry</button></div>;
 *
 *   return (
 *     <div>
 *       <h3>Account Balances</h3>
 *       {balances.length === 0 ? (
 *         <p>No balances found. Account may need funding.</p>
 *       ) : (
 *         balances.map((balance, index) => (
 *           <div key={index}>
 *             <strong>
 *               {balance.asset_type === 'native' ? 'XLM' : balance.asset_code}
 *               {balance.asset_issuer && ` (${balance.asset_issuer.substring(0, 8)}...)`}
 *             </strong>
 *             : {balance.balance}
 *             {balance.limit && ` (Limit: ${balance.limit})`}
 *           </div>
 *         ))
 *       )}
 *       <button onClick={refresh}>Refresh</button>
 *       <button onClick={stopPolling}>Stop Auto-Refresh</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useStellarBalances(
  publicKey?: string | null,
  options: UseStellarBalancesOptions = {}
): StellarBalancesState {
  // Auto-consume provider config as fallback
  const providerConfig = useWalletConfig();
  const {
    horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL,
    pollIntervalMs,
    enableStreaming = false,
  } = options;

  // State management
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Refs for cleanup and instance management
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const serverRef = useRef<Horizon.Server | null>(null);
  const lastHorizonUrlRef = useRef<string>('');

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
   * Stop polling if active
   */
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  /**
   * Validate Stellar public key format
   */
  const isValidPublicKey = useCallback((key: string): boolean => {
    // Stellar public keys are exactly 56 characters and start with 'G'
    return key.length === 56 && key.startsWith('G');
  }, []);

  /**
   * Fetch balances for the given public key
   *
   * The Horizon call goes through the shared client-side rate limiter, so
   * the live stream and the polling loop spend from one budget. The request
   * is counted exactly once, in the traffic class that triggered it (#1289).
   */
  const fetchBalances = useCallback(async (
    key: string,
    trafficClass: HorizonTrafficClass = 'poll',
  ): Promise<Balance[]> => {
    const server = serverRef.current;
    if (!server) {
      throw new Error('Horizon server not initialized');
    }

    if (!isValidPublicKey(key)) {
      throw new Error('Invalid Stellar public key format');
    }

    try {
      const account = await globalHorizonRateLimiter.execute(
        () => server.accounts().accountId(key).call(),
        trafficClass,
      );

      // Validate account structure
      if (!account || !account.balances || !Array.isArray(account.balances)) {
        throw new Error('Invalid account structure received from Horizon');
      }

      // Map Horizon balance format to our Balance interface
      const mappedBalances: Balance[] = account.balances.map((balance) => ({
        asset_type: balance.asset_type,
        asset_code: 'asset_code' in balance ? balance.asset_code : undefined,
        asset_issuer: 'asset_issuer' in balance ? balance.asset_issuer : undefined,
        balance: balance.balance,
        limit: 'limit' in balance ? balance.limit : undefined,
      }));

      return mappedBalances;
    } catch (err: unknown) {
      // Handle specific error cases
      if (err && typeof err === 'object' && 'response' in err && (err as { response?: { status?: number } }).response?.status === 404) {
        // Account doesn't exist on network (needs funding) - this is not an error
        return [];
      }

      // Network or server errors
      const errorObj = err as { message?: string; response?: { status?: number } };
      if (errorObj?.message?.includes('fetch') || (errorObj.response?.status && errorObj.response.status >= 500)) {
        throw new Error(`Network error: ${errorObj.message || 'Failed to connect to Horizon'}`);
      }

      // Client errors (400-499)
      if (errorObj.response?.status && errorObj.response.status >= 400 && errorObj.response.status < 500) {
        console.error('Horizon client error details:', {
          status: errorObj.response.status,
          message: errorObj.message,
          publicKey: key,
          horizonUrl: lastHorizonUrlRef.current
        });
        throw new Error(`Client error: ${errorObj.message || 'Invalid request to Horizon'} (Status: ${errorObj.response.status})`);
      }

      // Re-throw with more context
      throw err instanceof Error ? err : new Error('Unknown error fetching balances');
    }
  }, [isValidPublicKey]);

  /**
   * Run a single Horizon request and apply its result to the hook state.
   */
  const fetchAndApply = useCallback(async (
    key: string,
    trafficClass: HorizonTrafficClass,
  ): Promise<void> => {
    try {
      const newBalances = await fetchBalances(key, trafficClass);
      setBalances(newBalances);
      // Clear error state on successful fetch
      setError(null);
    } catch (err) {
      if (err instanceof HorizonRateLimitError) {
        // The shared client-side guard blocked this request. That is our own
        // throttle, not a Horizon failure: keep the balances we already have
        // and retry on the next tick instead of surfacing an error.
        return;
      }
      const error = err instanceof Error ? err : new Error('Failed to fetch balances');
      setError(error);
      console.error('Error fetching Stellar balances:', error);
      // Keep previous balances on error (don't wipe them) - per requirements
    }
  }, [fetchBalances]);

  /**
   * Refresh balances from Horizon.
   *
   * `source` records what triggered the refresh so the shared rate-limit
   * budget can charge it to the right traffic class: a live stream event is
   * `stream`, a scheduled poll is `poll` (#1289).
   */
  const runRefresh = useCallback(async (
    source: HorizonUpdateSource = 'poll',
  ): Promise<void> => {
    // If no public key, clear state and return
    if (!publicKey) {
      setBalances([]);
      setLoading(false);
      setError(null);
      return;
    }

    // Browser environment check
    if (typeof window === 'undefined') {
      setError(new Error('Browser environment required'));
      setLoading(false);
      return;
    }

    // A request for this account is already in flight: coalesce the trigger
    // into a single follow-up request instead of dropping it, so a live
    // stream update is never swallowed by a poll (or the other way round).
    if (inFlightRequests.has(publicKey)) {
      pendingRequests.add(publicKey);
      return;
    }

    inFlightRequests.add(publicKey);
    setLoading(true);
    setError(null); // Clear previous errors

    try {
      do {
        pendingRequests.delete(publicKey);
        await fetchAndApply(publicKey, source);
      } while (pendingRequests.has(publicKey));
    } finally {
      inFlightRequests.delete(publicKey);
      pendingRequests.delete(publicKey);
      setLoading(false);
    }
  }, [publicKey, fetchAndApply]);

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
      pollIntervalMs: pollIntervalMs ?? 15_000,
      streamType: 'payments',
    },
  );

  // Effect to handle publicKey changes and initial load
  useEffect(() => {
    // Stop any existing polling when publicKey changes
    stopPolling();

    // Clear error state when publicKey changes
    setError(null);

    if (!publicKey) {
      setBalances([]);
      setLoading(false);
      setError(null);
      return;
    }

    // Initial load
    refresh();

    // Start polling if interval is specified and valid
    if (pollIntervalMs && pollIntervalMs > 0) {
      const safeInterval = Math.max(pollIntervalMs, MIN_POLL_INTERVAL);

      pollIntervalRef.current = setInterval(() => {
        // Double-check publicKey is still valid before polling
        if (publicKey) {
          refresh();
        }
      }, safeInterval);
    }

    // Cleanup function for this effect
    return () => {
      stopPolling();
    };
  }, [publicKey, pollIntervalMs, refresh, stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
      // Drop any coalesced refresh for this account so a pending trigger
      // cannot fire another request after the hook is gone.
      if (publicKey) {
        pendingRequests.delete(publicKey);
      }
    };
  }, [stopPolling, publicKey]);

  return {
    balances,
    loading,
    error,
    refresh,
    stopPolling,
  };
}
