'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import { Horizon } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';
// Minimum polling interval safeguard (5 seconds)
const MIN_POLL_INTERVAL = 5000;
// Default Horizon URLs
const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
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
export function useStellarBalances(publicKey, options = {}) {
    // Auto-consume provider config as fallback
    const providerConfig = useWalletConfig();
    const { horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL, pollIntervalMs } = options;
    // State management
    const [balances, setBalances] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    // Refs for cleanup and instance management
    const pollIntervalRef = useRef(null);
    const serverRef = useRef(null);
    const lastHorizonUrlRef = useRef('');
    const isRequestInFlightRef = useRef(false);
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
    const isValidPublicKey = useCallback((key) => {
        // Stellar public keys are exactly 56 characters and start with 'G'
        return key.length === 56 && key.startsWith('G');
    }, []);
    /**
     * Fetch balances for the given public key
     */
    const fetchBalances = useCallback(async (key) => {
        if (!serverRef.current) {
            throw new Error('Horizon server not initialized');
        }
        if (!isValidPublicKey(key)) {
            throw new Error('Invalid Stellar public key format');
        }
        try {
            const account = await serverRef.current.accounts().accountId(key).call();
            // Validate account structure
            if (!account || !account.balances || !Array.isArray(account.balances)) {
                throw new Error('Invalid account structure received from Horizon');
            }
            // Map Horizon balance format to our Balance interface
            const mappedBalances = account.balances.map((balance) => ({
                asset_type: balance.asset_type,
                asset_code: 'asset_code' in balance ? balance.asset_code : undefined,
                asset_issuer: 'asset_issuer' in balance ? balance.asset_issuer : undefined,
                balance: balance.balance,
                limit: 'limit' in balance ? balance.limit : undefined,
            }));
            return mappedBalances;
        }
        catch (err) {
            // Handle specific error cases
            if (err && typeof err === 'object' && 'response' in err && err.response?.status === 404) {
                // Account doesn't exist on network (needs funding) - this is not an error
                return [];
            }
            // Network or server errors
            const errorObj = err;
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
    const refresh = useCallback(async () => {
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
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error('Failed to fetch balances');
            setError(error);
            console.error('Error fetching Stellar balances:', error);
            // Keep previous balances on error (don't wipe them) - per requirements
        }
        finally {
            setLoading(false);
            globalRequestInFlight = false;
            isRequestInFlightRef.current = false;
        }
    }, [publicKey, fetchBalances]);
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
