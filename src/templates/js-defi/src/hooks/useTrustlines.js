'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import { Horizon, Keypair, TransactionBuilder, Operation, Networks, Asset, BASE_FEE, Transaction } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';
// Default configuration
const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_NETWORK = 'TESTNET';
// Module-level request coordination to prevent duplicate requests
let globalRequestInFlight = false;
/**
 * Custom React hook for managing Stellar account trustlines
 *
 * Provides trustline parsing from account balances, XDR building for change-trust operations,
 * and dev-only signing/submission capabilities. Designed for secure trustline management
 * with external wallet integration for production use.
 *
 * @param publicKey - Stellar public key to fetch trustlines for (optional)
 * @param options - Configuration options including Horizon URL and network
 *
 * @example
 * ```tsx
 * function TrustlineManager({ publicKey }: { publicKey?: string }) {
 *   const {
 *     trustlines,
 *     loading,
 *     error,
 *     refresh,
 *     buildChangeTrustXDR,
 *     submitChangeTrustWithSecret
 *   } = useTrustlines(publicKey, {
 *     horizonUrl: 'https://horizon.stellar.org',
 *     network: 'PUBLIC'
 *   });
 *
 *   if (loading) return <div>Loading trustlines...</div>;
 *   if (error) return <div>Error: {error.message} <button onClick={refresh}>Retry</button></div>;
 *
 *   const handleAddTrustline = async () => {
 *     try {
 *       // Build unsigned XDR for external wallet signing
 *       const xdr = await buildChangeTrustXDR({
 *         code: 'USDC',
 *         issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
 *         limit: '1000000'
 *       });
 *       // Pass XDR to wallet for signing...
 *     } catch (err) {
 *       console.error('Failed to build XDR:', err);
 *     }
 *   };
 *
 *   // DEV-ONLY: Direct signing and submission
 *   const handleDevAddTrustline = async () => {
 *     try {
 *       const xdr = await buildChangeTrustXDR({
 *         code: 'USDC',
 *         issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
 *       });
 *       const result = await submitChangeTrustWithSecret(xdr, 'SABC123...'); // Never use in production
 *     } catch (err) {
 *       console.error('Failed to add trustline:', err);
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <h3>Account Trustlines</h3>
 *       {trustlines.length === 0 ? (
 *         <p>No trustlines found. Account only holds native XLM.</p>
 *       ) : (
 *         trustlines.map((trustline, index) => (
 *           <div key={index}>
 *             <strong>{trustline.asset_code}</strong>
 *             <span> (Issuer: {trustline.asset_issuer.substring(0, 8)}...)</span>
 *             <span> Balance: {trustline.balance || '0'}</span>
 *             {trustline.limit && <span> Limit: {trustline.limit}</span>}
 *             {trustline.authorized !== undefined && (
 *               <span> {trustline.authorized ? '✓ Authorized' : '✗ Not Authorized'}</span>
 *             )}
 *           </div>
 *         ))
 *       )}
 *       <button onClick={refresh}>Refresh</button>
 *       <button onClick={handleAddTrustline}>Add Trustline (External Wallet)</button>
 *       <button onClick={handleDevAddTrustline}>Add Trustline (Dev Only)</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTrustlines(publicKey, options = {}) {
    // Auto-consume provider config as fallback
    const providerConfig = useWalletConfig();
    const { horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL, network = DEFAULT_NETWORK } = options;
    // State management
    const [trustlines, setTrustlines] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    // Refs for cleanup and instance management
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
     * Get the network passphrase for the configured network
     */
    const getNetworkPassphrase = useCallback(() => {
        return network === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;
    }, [network]);
    /**
     * Validate Stellar public key format
     */
    const isValidPublicKey = useCallback((key) => {
        return key.length === 56 && key.startsWith('G');
    }, []);
    /**
     * Validate secret key format
     */
    const isValidSecret = useCallback((secret) => {
        return secret.length === 56 && secret.startsWith('S');
    }, []);
    /**
     * Parse trustlines from account balances
     * Maps account.balances entries where asset_type !== 'native' into Trustline[]
     */
    const parseTrustlinesFromBalances = useCallback((balances) => {
        return balances
            .filter(balance => balance.asset_type !== 'native')
            .map(balance => ({
            asset_code: 'asset_code' in balance ? balance.asset_code : '',
            asset_issuer: 'asset_issuer' in balance ? balance.asset_issuer : '',
            limit: 'limit' in balance ? balance.limit : undefined,
            balance: balance.balance,
            authorized: 'is_authorized' in balance ? balance.is_authorized : undefined
        }));
    }, []);
    /**
     * Fetch trustlines for the given public key
     */
    const fetchTrustlines = useCallback(async (key) => {
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
            // Parse trustlines from balances
            const parsedTrustlines = parseTrustlinesFromBalances(account.balances);
            return parsedTrustlines;
        }
        catch (err) {
            const errorObj = err;
            // Handle specific error cases
            if (errorObj?.response?.status === 404 || errorObj?.name === 'NotFoundError') {
                // Account doesn't exist on network (needs funding) - return empty trustlines
                return [];
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
                    horizonUrl: lastHorizonUrlRef.current
                });
                throw new Error(`Client error: ${errorObj.message || 'Invalid request to Horizon'} (Status: ${errorObj.response.status})`);
            }
            // Re-throw with more context
            throw err instanceof Error ? err : new Error('Unknown error fetching trustlines');
        }
    }, [isValidPublicKey, parseTrustlinesFromBalances]);
    /**
     * Refresh trustlines from Horizon
     */
    const refresh = useCallback(async () => {
        // If no public key, clear state and return
        if (!publicKey) {
            setTrustlines([]);
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
            const newTrustlines = await fetchTrustlines(publicKey);
            setTrustlines(newTrustlines);
            setError(null);
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error('Failed to fetch trustlines');
            setError(error);
            console.error('Error fetching Stellar trustlines:', error);
        }
        finally {
            setLoading(false);
            globalRequestInFlight = false;
            isRequestInFlightRef.current = false;
        }
    }, [publicKey, fetchTrustlines]);
    /**
     * Build an unsigned change-trust transaction XDR
     *
     * @param asset - Asset details including code, issuer, and optional limit
     * @returns Promise resolving to unsigned XDR string
     */
    const buildChangeTrustXDR = useCallback(async (asset) => {
        if (!serverRef.current) {
            throw new Error('Horizon server not initialized');
        }
        if (!publicKey) {
            throw new Error('Public key required to build change trust XDR');
        }
        // Validate inputs
        if (!isValidPublicKey(publicKey)) {
            throw new Error('Invalid public key format');
        }
        if (!asset.code || typeof asset.code !== 'string' || asset.code.length === 0) {
            throw new Error('Asset code is required');
        }
        if (!asset.issuer || !isValidPublicKey(asset.issuer)) {
            throw new Error('Valid asset issuer is required');
        }
        if (asset.limit && (isNaN(parseFloat(asset.limit)) || parseFloat(asset.limit) < 0)) {
            throw new Error('Asset limit must be a positive number');
        }
        try {
            // Load source account
            const account = await serverRef.current.loadAccount(publicKey);
            // Create asset
            const stellarAsset = new Asset(asset.code, asset.issuer);
            // Build transaction
            const txBuilder = new TransactionBuilder(account, {
                fee: BASE_FEE,
                networkPassphrase: getNetworkPassphrase(),
            });
            // Add change trust operation
            const changeTrustOp = asset.limit
                ? Operation.changeTrust({ asset: stellarAsset, limit: asset.limit })
                : Operation.changeTrust({ asset: stellarAsset });
            txBuilder.addOperation(changeTrustOp);
            txBuilder.setTimeout(30);
            const transaction = txBuilder.build();
            // Return unsigned XDR
            return transaction.toXDR();
        }
        catch (err) {
            const errorObj = err;
            // Handle specific Horizon errors
            if (errorObj?.response?.status === 404) {
                throw new Error(`Account ${publicKey} not found. Account may need funding.`);
            }
            if (errorObj.response?.status && errorObj.response.status >= 500) {
                throw new Error(`Horizon server error: ${errorObj.message || 'Network unavailable'}`);
            }
            if (errorObj.response?.status && errorObj.response.status >= 400) {
                throw new Error(`Invalid request: ${errorObj.message || 'Bad request to Horizon'}`);
            }
            // Re-throw validation and other errors
            throw err instanceof Error ? err : new Error('Failed to build change trust transaction');
        }
    }, [publicKey, isValidPublicKey, getNetworkPassphrase, serverRef]);
    /**
     * **DEVELOPMENT-ONLY**: Sign and submit a change-trust transaction using a secret key
     *
     * ⚠️ WARNING: This method is intended for development and testing purposes only.
     * Never use this in production applications. Secret keys should never be handled
     * directly in client-side code in production environments.
     *
     * Managing trustlines requires understanding of the issuing/authorization rules
     * for certain assets. Some assets require approval from the issuer before trustlines
     * can be established or used.
     *
     * @param xdr - Unsigned XDR string from buildChangeTrustXDR
     * @param secret - Secret key for signing (dev-only)
     * @returns Promise resolving to transaction submission result
     *
     * @example
     * ```tsx
     * // DEV-ONLY: For testing and development
     * const xdr = await buildChangeTrustXDR({
     *   code: 'USDC',
     *   issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
     *   limit: '1000000'
     * });
     * const result = await submitChangeTrustWithSecret(xdr, 'SABC123...');
     * ```
     */
    const submitChangeTrustWithSecret = useCallback(async (xdr, secret) => {
        if (!serverRef.current) {
            throw new Error('Horizon server not initialized');
        }
        // Validate secret key
        if (!secret || !isValidSecret(secret)) {
            throw new Error('Invalid secret key format');
        }
        if (!xdr || typeof xdr !== 'string') {
            throw new Error('Invalid XDR: must be a non-empty string');
        }
        try {
            // Create keypair from secret
            const keypair = Keypair.fromSecret(secret);
            // Verify secret corresponds to the publicKey if provided
            if (publicKey && keypair.publicKey() !== publicKey) {
                throw new Error('Secret key does not match the provided public key');
            }
            // Parse and sign transaction
            const transaction = new Transaction(xdr, getNetworkPassphrase());
            transaction.sign(keypair);
            // Submit to network
            const result = await serverRef.current.submitTransaction(transaction);
            // Refresh trustlines after successful submission
            await refresh();
            return {
                success: true,
                hash: result.hash,
                raw: result
            };
        }
        catch (err) {
            const errorObj = err;
            console.error('Change trust submission failed:', err);
            // Handle specific submission errors
            let errorMessage = 'Change trust transaction failed';
            if (errorObj?.response?.data?.extras?.result_codes) {
                const codes = errorObj.response.data.extras.result_codes;
                errorMessage = `Transaction failed - ${codes.transaction || codes.operations?.join(', ') || 'Unknown error'}`;
            }
            else if (errorObj?.response?.status === 400) {
                errorMessage = 'Invalid transaction format or content';
            }
            else if (errorObj.response?.status && errorObj.response.status >= 500) {
                errorMessage = 'Horizon server error during submission';
            }
            else if (errorObj?.message) {
                errorMessage = errorObj.message;
            }
            return {
                success: false,
                error: errorMessage,
                raw: errorObj?.response?.data
            };
        }
    }, [serverRef, isValidSecret, publicKey, getNetworkPassphrase, refresh]);
    // Effect to handle publicKey changes and initial load
    useEffect(() => {
        // Clear error state when publicKey changes
        setError(null);
        if (!publicKey) {
            setTrustlines([]);
            setLoading(false);
            setError(null);
            return;
        }
        // Initial load
        refresh();
    }, [publicKey, refresh]);
    // Cleanup on unmount
    useEffect(() => {
        return () => {
            // Reset global state on unmount
            if (isRequestInFlightRef.current) {
                globalRequestInFlight = false;
                isRequestInFlightRef.current = false;
            }
        };
    }, []);
    return {
        trustlines,
        loading,
        error,
        refresh,
        buildChangeTrustXDR,
        submitChangeTrustWithSecret,
    };
}
