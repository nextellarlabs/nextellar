'use client';
import { useCallback, useRef, useEffect } from 'react';
import { Horizon, Keypair, TransactionBuilder, Operation, Networks, Asset, Memo, BASE_FEE, Transaction } from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';
// Default configuration
const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_NETWORK = 'TESTNET';
/**
 * Custom React hook for building and submitting Stellar payment transactions
 *
 * This hook provides utilities for:
 * 1. Building unsigned payment XDRs for external wallet signing
 * 2. Submitting already-signed XDR transactions
 * 3. Development-only signing and submission with a secret key
 *
 * @param options - Configuration options including Horizon URL and network
 *
 * @example
 * ```tsx
 * function PaymentComponent() {
 *   const { buildPaymentXDR, submitSignedXDR, signAndSubmitWithSecret } = useStellarPayment({
 *     horizonUrl: 'https://horizon.stellar.org',
 *     network: 'PUBLIC'
 *   });
 *
 *   const handleBuildPayment = async () => {
 *     const xdr = await buildPaymentXDR({
 *       from: 'GABC123...',
 *       to: 'GDEF456...',
 *       amount: '10.5',
 *       asset: 'XLM',
 *       memo: 'Test payment'
 *     });
 *     // Pass XDR to wallet for signing
 *   };
 *
 *   const handleSubmitSigned = async (signedXdr: string) => {
 *     const result = await submitSignedXDR(signedXdr);
 *     if (result.success) {
 *       console.log('Transaction hash:', result.txHash);
 *     }
 *   };
 *
 *   // DEV-ONLY: Direct signing and submission
 *   const handleDevPayment = async () => {
 *     const result = await signAndSubmitWithSecret({
 *       from: 'GABC123...',
 *       to: 'GDEF456...',
 *       amount: '10.5',
 *       secret: 'SABC123...' // Never use in production
 *     });
 *   };
 *
 *   return <div>Payment controls here</div>;
 * }
 * ```
 */
export function useStellarPayment(opts) {
    // Auto-consume provider config as fallback
    const providerConfig = useWalletConfig();
    const { horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL, network = DEFAULT_NETWORK } = opts || {};
    // Refs for persistent instances
    const serverRef = useRef(null);
    const lastHorizonUrlRef = useRef('');
    // Initialize Horizon server instance when URL changes
    useEffect(() => {
        if (lastHorizonUrlRef.current !== horizonUrl) {
            try {
                serverRef.current = new Horizon.Server(horizonUrl);
                lastHorizonUrlRef.current = horizonUrl;
            }
            catch (err) {
                console.error('Failed to initialize Horizon server:', err);
                throw new Error(`Invalid Horizon URL: ${horizonUrl}`);
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
     * Validate Stellar address format
     */
    const isValidAddress = useCallback((address) => {
        return address.length === 56 && address.startsWith('G');
    }, []);
    /**
     * Validate secret key format
     */
    const isValidSecret = useCallback((secret) => {
        return secret.length === 56 && secret.startsWith('S');
    }, []);
    /**
     * Validate amount format
     */
    const isValidAmount = useCallback((amount) => {
        const parsed = parseFloat(amount);
        return !isNaN(parsed) && parsed > 0 && parsed <= 922337203685.4775807;
    }, []);
    /**
     * Validate payment parameters
     */
    const validatePaymentParams = useCallback((params) => {
        if (!isValidAddress(params.from)) {
            throw new Error('Invalid sender address format');
        }
        if (!isValidAddress(params.to)) {
            throw new Error('Invalid recipient address format');
        }
        if (!isValidAmount(params.amount)) {
            throw new Error('Invalid amount: must be positive number within Stellar limits');
        }
        if (params.from === params.to) {
            throw new Error('Sender and recipient cannot be the same address');
        }
    }, [isValidAddress, isValidAmount]);
    /**
     * Build an unsigned payment transaction XDR
     *
     * @param params - Payment parameters
     * @returns Promise resolving to unsigned XDR string
     */
    const buildPaymentXDR = useCallback(async (params) => {
        if (!serverRef.current) {
            throw new Error('Horizon server not initialized');
        }
        // Validate inputs
        validatePaymentParams(params);
        try {
            // Load source account
            const account = await serverRef.current.loadAccount(params.from);
            // Determine asset
            const asset = params.asset === 'XLM' || !params.asset
                ? Asset.native()
                : new Asset(params.asset.code, params.asset.issuer);
            // Build transaction
            const txBuilder = new TransactionBuilder(account, {
                fee: BASE_FEE,
                networkPassphrase: getNetworkPassphrase(),
            });
            // Add payment operation
            txBuilder.addOperation(Operation.payment({
                destination: params.to,
                asset: asset,
                amount: params.amount,
            }));
            // Add memo if provided
            if (params.memo) {
                if (params.memo.length > 28) {
                    throw new Error('Memo text cannot exceed 28 characters');
                }
                txBuilder.addMemo(Memo.text(params.memo));
            }
            txBuilder.setTimeout(30);
            const transaction = txBuilder.build();
            // Return unsigned XDR
            return transaction.toXDR();
        }
        catch (err) {
            const errorObj = err;
            // Handle specific Horizon errors
            if (errorObj?.response?.status === 404) {
                throw new Error(`Account ${params.from} not found. Account may need funding.`);
            }
            if (errorObj?.response?.status && errorObj.response.status >= 500) {
                throw new Error(`Horizon server error: ${errorObj.message || 'Network unavailable'}`);
            }
            if (errorObj?.response?.status && errorObj.response.status >= 400) {
                throw new Error(`Invalid request: ${errorObj.message || 'Bad request to Horizon'}`);
            }
            // Re-throw validation and other errors
            throw err instanceof Error ? err : new Error('Failed to build payment transaction');
        }
    }, [serverRef, validatePaymentParams, getNetworkPassphrase]);
    /**
     * Submit a signed transaction XDR to the network
     *
     * @param signedXdrBase64 - Base64-encoded signed transaction XDR
     * @returns Promise resolving to PaymentResult
     */
    const submitSignedXDR = useCallback(async (signedXdrBase64) => {
        if (!serverRef.current) {
            throw new Error('Horizon server not initialized');
        }
        if (!signedXdrBase64 || typeof signedXdrBase64 !== 'string') {
            return {
                success: false,
                error: 'Invalid XDR: must be a non-empty string'
            };
        }
        try {
            // Parse the signed transaction
            const transaction = new Transaction(signedXdrBase64, getNetworkPassphrase());
            // Submit to network
            const result = await serverRef.current.submitTransaction(transaction);
            return {
                success: true,
                txHash: result.hash,
                raw: result
            };
        }
        catch (err) {
            const errorObj = err;
            console.error('Transaction submission failed:', err);
            // Handle specific submission errors
            let errorMessage = 'Transaction failed';
            if (errorObj?.response?.data?.extras?.result_codes) {
                const codes = errorObj.response.data.extras.result_codes;
                errorMessage = `Transaction failed - ${codes.transaction || codes.operations?.join(', ') || 'Unknown error'}`;
            }
            else if (errorObj?.response?.status === 400) {
                errorMessage = 'Invalid transaction format or content';
            }
            else if (errorObj?.response?.status && errorObj.response.status >= 500) {
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
    }, [serverRef, getNetworkPassphrase]);
    /**
     * **DEVELOPMENT-ONLY**: Sign and submit a payment transaction using a secret key
     *
     * ⚠️ WARNING: This method is intended for development and testing purposes only.
     * Never use this in production applications. Secret keys should never be handled
     * directly in client-side code in production environments.
     *
     * @param params - Payment parameters including the secret key
     * @returns Promise resolving to PaymentResult
     *
     * @example
     * ```tsx
     * // DEV-ONLY: For testing and development
     * const result = await signAndSubmitWithSecret({
     *   from: 'GABC123...',
     *   to: 'GDEF456...',
     *   amount: '10.5',
     *   secret: 'SABC123...',
     *   memo: 'Test payment'
     * });
     * ```
     */
    const signAndSubmitWithSecret = useCallback(async (params) => {
        // Validate secret key
        if (!params.secret || !isValidSecret(params.secret)) {
            return {
                success: false,
                error: 'Invalid secret key format'
            };
        }
        try {
            // Verify secret corresponds to the from address
            const keypair = Keypair.fromSecret(params.secret);
            if (keypair.publicKey() !== params.from) {
                return {
                    success: false,
                    error: 'Secret key does not match sender address'
                };
            }
            // Build unsigned transaction
            const unsignedXdr = await buildPaymentXDR(params);
            // Sign transaction
            const transaction = new Transaction(unsignedXdr, getNetworkPassphrase());
            transaction.sign(keypair);
            // Submit signed transaction
            const result = await submitSignedXDR(transaction.toXDR());
            return result;
        }
        catch (err) {
            console.error('Sign and submit failed:', err);
            return {
                success: false,
                error: err instanceof Error ? err.message : 'Sign and submit operation failed'
            };
        }
    }, [buildPaymentXDR, submitSignedXDR, getNetworkPassphrase, isValidSecret]);
    return {
        buildPaymentXDR,
        submitSignedXDR,
        signAndSubmitWithSecret,
    };
}
