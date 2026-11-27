'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Operation,
  Networks,
  BASE_FEE,
  Transaction,
  xdr,
} from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';

/**
 * Account data entry interface representing a key-value pair stored on a Stellar account
 */
export type AccountDataEntry = {
  key: string;
  value: string; // Base64-encoded value
  /** Decoded UTF-8 string value (if valid UTF-8) */
  valueDecoded?: string;
};

/**
 * Options for the useAccountData hook
 */
export interface UseAccountDataOptions {
  horizonUrl?: string;
  network?: 'TESTNET' | 'PUBLIC';
}

/**
 * Return type for the useAccountData hook
 */
export interface AccountDataState {
  entries: AccountDataEntry[];
  loading: boolean;
  error?: Error | null;
  refresh: () => Promise<void>;
  /** Build unsigned XDR for setting a data entry */
  buildSetDataXDR: (key: string, value: string | Uint8Array) => Promise<string>;
  /** Build unsigned XDR for removing a data entry */
  buildRemoveDataXDR: (key: string) => Promise<string>;
  /** Submit a signed XDR transaction */
  submitSignedXDR: (signedXdrBase64: string) => Promise<{ success: boolean; hash?: string; raw?: unknown; error?: string }>;
  /** DEV-ONLY: Sign and submit a set data transaction with a secret key */
  submitSetDataWithSecret: (key: string, value: string | Uint8Array, secret: string) => Promise<{ success: boolean; hash?: string; raw?: unknown; error?: string }>;
  /** DEV-ONLY: Sign and submit a remove data transaction with a secret key */
  submitRemoveDataWithSecret: (key: string, secret: string) => Promise<{ success: boolean; hash?: string; raw?: unknown; error?: string }>;
}

// Default configuration
const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_NETWORK = 'TESTNET';

// Stellar protocol limits
const MAX_DATA_KEY_LENGTH = 64;
const MAX_DATA_VALUE_LENGTH = 64;

// Module-level request coordination to prevent duplicate requests
let globalRequestInFlight = false;

/**
 * Custom React hook for managing Stellar account data entries (manageData)
 * 
 * Provides:
 * - Reading and decoding data entries from account.data
 * - Building unsigned XDR for set/remove data operations
 * - Dev-only signing and submission capabilities
 * - Enforces 64-byte key/value limits with clear errors
 * 
 * @param publicKey - Stellar public key to fetch data entries for (optional)
 * @param options - Configuration options including Horizon URL and network
 * 
 * @example
 * ```tsx
 * function DataManager({ publicKey }: { publicKey?: string }) {
 *   const { 
 *     entries, 
 *     loading, 
 *     error, 
 *     refresh, 
 *     buildSetDataXDR,
 *     buildRemoveDataXDR,
 *     submitSignedXDR,
 *     submitSetDataWithSecret,
 *     submitRemoveDataWithSecret 
 *   } = useAccountData(publicKey, {
 *     horizonUrl: 'https://horizon.stellar.org',
 *     network: 'PUBLIC'
 *   });
 *   
 *   if (loading) return <div>Loading data entries...</div>;
 *   if (error) return <div>Error: {error.message} <button onClick={refresh}>Retry</button></div>;
 *   
 *   const handleSetData = async () => {
 *     try {
 *       // Build unsigned XDR for external wallet signing
 *       const xdr = await buildSetDataXDR('config', '{"theme": "dark"}');
 *       // Pass XDR to wallet for signing...
 *     } catch (err) {
 *       console.error('Failed to build XDR:', err);
 *     }
 *   };
 *   
 *   const handleRemoveData = async () => {
 *     try {
 *       const xdr = await buildRemoveDataXDR('config');
 *       // Pass XDR to wallet for signing...
 *     } catch (err) {
 *       console.error('Failed to build XDR:', err);
 *     }
 *   };
 *   
 *   // DEV-ONLY: Direct signing and submission
 *   const handleDevSetData = async () => {
 *     try {
 *       const result = await submitSetDataWithSecret('config', '{"theme": "dark"}', 'SABC123...'); // Never use in production
 *     } catch (err) {
 *       console.error('Failed to set data:', err);
 *     }
 *   };
 *   
 *   return (
 *     <div>
 *       <h3>Account Data Entries</h3>
 *       {entries.length === 0 ? (
 *         <p>No data entries found.</p>
 *       ) : (
 *         entries.map((entry, index) => (
 *           <div key={index}>
 *             <strong>{entry.key}</strong>
 *             <span> Value: {entry.valueDecoded ?? entry.value}</span>
 *             <button onClick={() => handleRemoveData(entry.key)}>Remove</button>
 *           </div>
 *         ))
 *       )}
 *       <button onClick={refresh}>Refresh</button>
 *       <button onClick={handleSetData}>Set Data (External Wallet)</button>
 *       <button onClick={handleDevSetData}>Set Data (Dev Only)</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useAccountData(
  publicKey?: string | null,
  options: UseAccountDataOptions = {}
): AccountDataState {
  // Auto-consume provider config as fallback
  const providerConfig = useWalletConfig();
  const { 
    horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL, 
    network = DEFAULT_NETWORK
  } = options;
  
  // State management
  const [entries, setEntries] = useState<AccountDataEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  // Refs for cleanup and instance management
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
   * Get the network passphrase for the configured network
   */
  const getNetworkPassphrase = useCallback((): string => {
    return network === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;
  }, [network]);

  /**
   * Validate Stellar public key format
   */
  const isValidPublicKey = useCallback((key: string): boolean => {
    return key.length === 56 && key.startsWith('G');
  }, []);

  /**
   * Validate secret key format
   */
  const isValidSecret = useCallback((secret: string): boolean => {
    return secret.length === 56 && secret.startsWith('S');
  }, []);

  /**
   * Validate data key length (max 64 bytes)
   */
  const validateDataKey = useCallback((key: string): void => {
    if (!key || typeof key !== 'string') {
      throw new Error('Data key must be a non-empty string');
    }
    const keyBytes = new TextEncoder().encode(key);
    if (keyBytes.length > MAX_DATA_KEY_LENGTH) {
      throw new Error(`Data key exceeds maximum length of ${MAX_DATA_KEY_LENGTH} bytes (got ${keyBytes.length} bytes)`);
    }
  }, []);

  /**
   * Validate data value length (max 64 bytes)
   */
  const validateDataValue = useCallback((value: string | Uint8Array): void => {
    if (value === undefined || value === null) {
      throw new Error('Data value must be provided');
    }
    const valueBytes = typeof value === 'string' 
      ? new TextEncoder().encode(value) 
      : value;
    if (valueBytes.length > MAX_DATA_VALUE_LENGTH) {
      throw new Error(`Data value exceeds maximum length of ${MAX_DATA_VALUE_LENGTH} bytes (got ${valueBytes.length} bytes)`);
    }
  }, []);

  /**
   * Decode base64 value to UTF-8 string if possible
   */
  const decodeValue = useCallback((value: string): string | undefined => {
    try {
      // Try to decode as base64 then UTF-8
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder().decode(bytes);
    } catch {
      // If decoding fails, return undefined (keep original base64)
      return undefined;
    }
  }, []);

  /**
   * Parse data entries from account data
   */
  const parseDataEntries = useCallback((data: Record<string, string>): AccountDataEntry[] => {
    if (!data || typeof data !== 'object') {
      return [];
    }
    return Object.entries(data).map(([key, value]) => ({
      key,
      value,
      valueDecoded: decodeValue(value),
    }));
  }, [decodeValue]);

  /**
   * Fetch data entries for the given public key
   */
  const fetchDataEntries = useCallback(async (key: string): Promise<AccountDataEntry[]> => {
    if (!serverRef.current) {
      throw new Error('Horizon server not initialized');
    }

    if (!isValidPublicKey(key)) {
      throw new Error('Invalid Stellar public key format');
    }

    try {
      const account = await serverRef.current.accounts().accountId(key).call();
      
      // Validate account structure
      if (!account || !account.data || typeof account.data !== 'object') {
        return [];
      }
      
      // Parse data entries from account.data
      const parsedEntries = parseDataEntries(account.data);
      
      return parsedEntries;
    } catch (err: unknown) {
      const errorObj = err as { response?: { status?: number }; message?: string; name?: string };
      // Handle specific error cases
      if (errorObj?.response?.status === 404 || errorObj?.name === 'NotFoundError') {
        // Account doesn't exist on network (needs funding) - return empty entries
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
      throw err instanceof Error ? err : new Error('Unknown error fetching data entries');
    }
  }, [isValidPublicKey, parseDataEntries]);

  /**
   * Refresh data entries from Horizon
   */
  const refresh = useCallback(async (): Promise<void> => {
    // If no public key, clear state and return
    if (!publicKey) {
      setEntries([]);
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
      const newEntries = await fetchDataEntries(publicKey);
      setEntries(newEntries);
      setError(null);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch data entries');
      setError(error);
      console.error('Error fetching Stellar account data:', error);
    } finally {
      setLoading(false);
      globalRequestInFlight = false;
      isRequestInFlightRef.current = false;
    }
  }, [publicKey, fetchDataEntries]);

  /**
   * Build an unsigned set-data transaction XDR
   * 
   * @param key - Data key (max 64 bytes)
   * @param value - Data value as string or Uint8Array (max 64 bytes)
   * @returns Promise resolving to unsigned XDR string
   */
  const buildSetDataXDR = useCallback(async (
    key: string,
    value: string | Uint8Array
  ): Promise<string> => {
    if (!serverRef.current) {
      throw new Error('Horizon server not initialized');
    }

    if (!publicKey) {
      throw new Error('Public key required to build set data XDR');
    }

    // Validate inputs
    if (!isValidPublicKey(publicKey)) {
      throw new Error('Invalid public key format');
    }

    validateDataKey(key);
    validateDataValue(value);

    try {
      // Load source account
      const account = await serverRef.current.loadAccount(publicKey);
      
      // Convert value to base64 if string, or use Uint8Array directly
      const valueBytes = typeof value === 'string' 
        ? new TextEncoder().encode(value) 
        : value;
      const valueBase64 = btoa(String.fromCharCode(...valueBytes));

      // Build transaction
      const txBuilder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: getNetworkPassphrase(),
      });

      // Add manage data operation (set)
      txBuilder.addOperation(Operation.manageData({
        name: key,
        value: valueBase64,
      }));

      txBuilder.setTimeout(30);
      
      const transaction = txBuilder.build();

      // Return unsigned XDR
      return transaction.toXDR();
    } catch (err: unknown) {
      const errorObj = err as { response?: { status?: number }; message?: string };
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
      throw err instanceof Error ? err : new Error('Failed to build set data transaction');
    }
  }, [publicKey, isValidPublicKey, getNetworkPassphrase, validateDataKey, validateDataValue]);

  /**
   * Build an unsigned remove-data transaction XDR
   * 
   * @param key - Data key to remove (max 64 bytes)
   * @returns Promise resolving to unsigned XDR string
   */
  const buildRemoveDataXDR = useCallback(async (
    key: string
  ): Promise<string> => {
    if (!serverRef.current) {
      throw new Error('Horizon server not initialized');
    }

    if (!publicKey) {
      throw new Error('Public key required to build remove data XDR');
    }

    // Validate inputs
    if (!isValidPublicKey(publicKey)) {
      throw new Error('Invalid public key format');
    }

    validateDataKey(key);

    try {
      // Load source account
      const account = await serverRef.current.loadAccount(publicKey);

      // Build transaction
      const txBuilder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: getNetworkPassphrase(),
      });

      // Add manage data operation (remove - value is null/undefined)
      txBuilder.addOperation(Operation.manageData({
        name: key,
        value: null,
      }));

      txBuilder.setTimeout(30);
      
      const transaction = txBuilder.build();

      // Return unsigned XDR
      return transaction.toXDR();
    } catch (err: unknown) {
      const errorObj = err as { response?: { status?: number }; message?: string };
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
      throw err instanceof Error ? err : new Error('Failed to build remove data transaction');
    }
  }, [publicKey, isValidPublicKey, getNetworkPassphrase, validateDataKey]);

  /**
   * Submit a signed transaction XDR to the network
   * 
   * @param signedXdrBase64 - Base64-encoded signed transaction XDR
   * @returns Promise resolving to transaction submission result
   */
  const submitSignedXDR = useCallback(async (
    signedXdrBase64: string
  ): Promise<{ success: boolean; hash?: string; raw?: unknown; error?: string }> => {
    if (!serverRef.current) {
      throw new Error('Horizon server not initialized');
    }

    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (
      !signedXdrBase64 || 
      typeof signedXdrBase64 !== 'string' || 
      signedXdrBase64.length <= 50 || 
      !base64Regex.test(signedXdrBase64)
    ) {
      throw new Error('Invalid signed transaction XDR. The wallet may have returned a corrupted response.');
    }

    try {
      // Parse the signed transaction
      const transaction = new Transaction(signedXdrBase64, getNetworkPassphrase());
      
      // Submit to network
      const result = await serverRef.current.submitTransaction(transaction);
      
      return {
        success: true,
        hash: result.hash,
        raw: result
      };
    } catch (err: unknown) {
      const errorObj = err as { response?: { status?: number; data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } }; message?: string };
      console.error('Transaction submission failed:', err);
      
      // Handle specific submission errors
      let errorMessage = 'Transaction failed';
      if (errorObj?.response?.data?.extras?.result_codes) {
        const codes = errorObj.response.data.extras.result_codes;
        errorMessage = `Transaction failed - ${codes.transaction || codes.operations?.join(', ') || 'Unknown error'}`;
      } else if (errorObj?.response?.status === 400) {
        errorMessage = 'Invalid transaction format or content';
      } else if (errorObj.response?.status && errorObj.response.status >= 500) {
        errorMessage = 'Horizon server error during submission';
      } else if (errorObj?.message) {
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
   * **DEVELOPMENT-ONLY**: Sign and submit a set-data transaction using a secret key
   * 
   * ⚠️ WARNING: This method is intended for development and testing purposes only.
   * Never use this in production applications. Secret keys should never be handled
   * directly in client-side code in production environments.
   * 
   * @param key - Data key (max 64 bytes)
   * @param value - Data value as string or Uint8Array (max 64 bytes)
   * @param secret - Secret key for signing (dev-only)
   * @returns Promise resolving to transaction submission result
   */
  const submitSetDataWithSecret = useCallback(async (
    key: string,
    value: string | Uint8Array,
    secret: string
  ): Promise<{ success: boolean; hash?: string; raw?: unknown; error?: string }> => {
    // Validate secret key
    if (!secret || !isValidSecret(secret)) {
      return {
        success: false,
        error: 'Invalid secret key format'
      };
    }

    try {
      // Verify secret corresponds to the publicKey if provided
      const keypair = Keypair.fromSecret(secret);
      if (publicKey && keypair.publicKey() !== publicKey) {
        return {
          success: false,
          error: 'Secret key does not match the provided public key'
        };
      }

      // Build unsigned transaction
      const unsignedXdr = await buildSetDataXDR(key, value);
      
      // Sign transaction
      const transaction = new Transaction(unsignedXdr, getNetworkPassphrase());
      transaction.sign(keypair);
      
      // Submit signed transaction
      const result = await submitSignedXDR(transaction.toXDR());
      
      // Refresh data entries after successful submission
      if (result.success) {
        await refresh();
      }
      
      return result;
    } catch (err: unknown) {
      console.error('Sign and submit set data failed:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Sign and submit operation failed'
      };
    }
  }, [publicKey, isValidSecret, buildSetDataXDR, submitSignedXDR, getNetworkPassphrase, refresh]);

  /**
   * **DEVELOPMENT-ONLY**: Sign and submit a remove-data transaction using a secret key
   * 
   * ⚠️ WARNING: This method is intended for development and testing purposes only.
   * Never use this in production applications. Secret keys should never be handled
   * directly in client-side code in production environments.
   * 
   * @param key - Data key to remove (max 64 bytes)
   * @param secret - Secret key for signing (dev-only)
   * @returns Promise resolving to transaction submission result
   */
  const submitRemoveDataWithSecret = useCallback(async (
    key: string,
    secret: string
  ): Promise<{ success: boolean; hash?: string; raw?: unknown; error?: string }> => {
    // Validate secret key
    if (!secret || !isValidSecret(secret)) {
      return {
        success: false,
        error: 'Invalid secret key format'
      };
    }

    try {
      // Verify secret corresponds to the publicKey if provided
      const keypair = Keypair.fromSecret(secret);
      if (publicKey && keypair.publicKey() !== publicKey) {
        return {
          success: false,
          error: 'Secret key does not match the provided public key'
        };
      }

      // Build unsigned transaction
      const unsignedXdr = await buildRemoveDataXDR(key);
      
      // Sign transaction
      const transaction = new Transaction(unsignedXdr, getNetworkPassphrase());
      transaction.sign(keypair);
      
      // Submit signed transaction
      const result = await submitSignedXDR(transaction.toXDR());
      
      // Refresh data entries after successful submission
      if (result.success) {
        await refresh();
      }
      
      return result;
    } catch (err: unknown) {
      console.error('Sign and submit remove data failed:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Sign and submit operation failed'
      };
    }
  }, [publicKey, isValidSecret, buildRemoveDataXDR, submitSignedXDR, getNetworkPassphrase, refresh]);

  // Effect to handle publicKey changes and initial load
  useEffect(() => {
    // Clear error state when publicKey changes
    setError(null);
    
    if (!publicKey) {
      setEntries([]);
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
    entries,
    loading,
    error,
    refresh,
    buildSetDataXDR,
    buildRemoveDataXDR,
    submitSignedXDR,
    submitSetDataWithSecret,
    submitRemoveDataWithSecret,
  };
}