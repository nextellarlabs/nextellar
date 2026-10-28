'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Horizon } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';
import { useHorizonStreaming } from './useHorizonStreaming';

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
 * Shared Horizon rate limiter.
 *
 * All `useStellarBalances` hook instances (and any other Horizon-backed hooks)
 * route their requests through this single module-level limiter so that
 * concurrent polling cannot overwhelm the Horizon endpoint.
 */
export const DEFAULT_HORIZON_RATE_LIMIT = 5;
export const DEFAULT_HORIZON_RATE_WINDOW_MS = 1000;

export interface HorizonRateLimiterOptions {
  /** Maximum number of requests allowed per window. */
  maxRequests?: number;
  /** Window length in milliseconds. */
  windowMs?: number;
}

export interface HorizonRateLimiterStats {
  /** Number of requests currently waiting for a slot. */
  queuedLength: number;
  /** Number of requests dispatched in the current window. */
  dispatchedInWindow: number;
  /** Total number of requests dispatched since creation. */
  totalDispatched: number;
}

type RateLimiterTask = {
  resolve: () => void;
  reject: (error: Error) => void;
};

export class HorizonRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private queue: RateLimiterTask[] = [];
  private dispatchedInWindow = 0;
  private totalDispatched = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private windowStartedAt = 0;
  private disposed = false;

  constructor(options: HorizonRateLimiterOptions = {}) {
    const maxRequests = options.maxRequests ?? DEFAULT_HORIZON_RATE_LIMIT;
    const windowMs = options.windowMs ?? DEFAULT_HORIZON_RATE_WINDOW_MS;

    if (!Number.isFinite(maxRequests) || maxRequests < 1) {
      throw new Error('HorizonRateLimiter: maxRequests must be a positive integer');
    }
    if (!Number.isFinite(windowMs) || windowMs < 1) {
      throw new Error('HorizonRateLimiter: windowMs must be a positive integer');
    }

    this.maxRequests = Math.floor(maxRequests);
    this.windowMs = Math.floor(windowMs);
  }

  /**
   * Wait for a slot in the current rate-limit window.
   * Resolves once the request is allowed to proceed.
   */
  acquire(): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('HorizonRateLimiter has been disposed'));
    }

    return new Promise<void>((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Convenience wrapper that acquires a slot and then runs the task.
   */
  async schedule<T>(fan: () => Promise<T> | T): Promise<T> {
    await this.acquire();
    return fan();
  }

  getStats(): HorizonRateLimiterStats {
    return {
      queuedLength: this.queue.length,
      dispatchedInWindow: this.dispatchedInWindow,
      totalDispatched: this.totalDispatched,
    };
  }

  /**
   * Reset the limiter to a fresh state. Useful for tests and for recovery
   * after a long suspension.
   */
  reset(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.dispatchedInWindow = 0;
    this.windowStartedAt = 0;
  }

  /**
   * Reject all pending requests and stop accepting new ones.
   */
  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const pending = this.queue.splice(0);
    for (const task of pending) {
      task.reject(new Error('HorizonRateLimiter has been disposed'));
    }
  }

  private processQueue(): void {
    if (this.disposed) return;
    if (this.queue.length === 0) return;

    const now = Date.now();
    if (this.windowStartedAt === 0) {
      this.windowStartedAt = now;
    }

    // Roll the window forward if it elapsed.
    if (now - this.windowStartedAt >= this.windowMs) {
      this.windowStartedAt = now;
      this.dispatchedInWindow = 0;
    }

    while (this.queue.length > 0 && this.dispatchedInWindow < this.maxRequests) {
      const task = this.queue.shift();
      if (!task) break;
      this.dispatchedInWindow += 1;
      this.totalDispatched += 1;
      task.resolve();
    }

    if (this.queue.length > 0 && this.timer === null) {
      const remaining = this.windowMs - (now - this.windowStartedAt);
      const delay = remaining > 0 ? remaining : 0;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.windowStartedAt = 0;
        this.dispatchedInWindow = 0;
        this.processQueue();
      }, delay);
    }
  }
}

/**
 * Shared module-level rate limiter instance used by all hook instances.
 */
export const horizonRateLimiter = new HorizonRateLimiter();

// Module-level request coordination to prevent duplicate requests
let globalRequestInFlight = false;

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
  const isRequestInFlightRef = useRef(false);
  
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
   */
  const fetchBalances = useCallback(async (key: string): Promise<Balance[]> => {
    if (!serverRef.current) {
      throw new Error('Horizon server not initialized');
    }

    if (!isValidPublicKey(key)) {
      throw new Error('Invalid Stellar public key format');
    }

    try {
      // Route through the shared rate limiter so concurrent hook
      // instances cannot exceed the Horizon request budget.
      const account = await horizonRateLimiter.schedule(() =>
        serverRef.current!.accounts().accountId(key).call()
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
   * Refresh balances from Horizon
   */
  const refresh = useCallback(async (): Promise<void> => {
    // If no public key, clear state and return
    if (!publicKey) {
      setBalances([]);
      setLoading(false);
      setError(null);
      return;
    }

    // Prevent duplicate requests across hook instances
    if (globalRequestInFlight || isRequestInFlightRef.current) {
      return;
    }

    // Browser environment check
    if (typeof window === 'undefined') {
      setError(new Error('Browser environment required'));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null); // Clear previous errors
    globalRequestInFlight = true;
    isRequestInFlightRef.current = true;
    
    try {
      const newBalances = await fetchBalances(publicKey);
      setBalances(newBalances);
      // Clear error state on successful fetch
      setError(null);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch balances');
      setError(error);
      console.error('Error fetching Stellar balances:', error);
      // Keep previous balances on error (don't wipe them) - per requirements
    } finally {
      setLoading(false);
      globalRequestInFlight = false;
      isRequestInFlightRef.current = false;
    }
  }, [publicKey, fetchBalances]);

  useHorizonStreaming(publicKey, refresh, {
    horizonUrl,
    enabled: enableStreaming,
    pollIntervalMs: pollIntervalMs ?? 15_000,
    streamType: 'payments',
  });

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
      // Reset global state on unmount
      if (isRequestInFlightRef.current) {
        globalRequestInFlight = false;
        isRequestInFlightRef.current = false;
      }
    };
  }, [stopPolling]);

  return {
    balances,
    loading,
    error,
    refresh,
    stopPolling,
  };
}
