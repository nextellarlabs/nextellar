'use client';

import { useState, useCallback, useEffect } from 'react';
import { 
  Horizon, 
  TransactionBuilder, 
  Operation, 
  Networks, 
  Asset,
  Memo,
  BASE_FEE
} from '@stellar/stellar-sdk';
import { ISupportedWallet } from "@creit.tech/stellar-wallets-kit";
import { kit } from '../lib/stellar-wallet-kit';

// Use Horizon.Server instead of just Server
const Server = Horizon.Server;

/**
 * Balance interface for account assets
 */
export interface Balance {
  balance: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
}

/**
 * Payment options for sendPayment function
 */
export interface PaymentOptions {
  to: string;
  amount: string;
  asset?: 'XLM' | { code: string; issuer: string };
  memo?: string;
  secret?: string; // DEV-ONLY: For local signing in development
}

/**
 * Return type for the useStellarWallet hook
 */
export interface StellarWalletState {
  connected: boolean;
  publicKey?: string;
  walletName?: string;
  balances: Balance[];
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
  sendPayment?: (opts: PaymentOptions) => Promise<Horizon.HorizonApi.SubmitTransactionResponse>;
}

/**
 * Custom React hook for Stellar wallet integration using Stellar Wallets Kit
 * 
 * This hook provides a clean interface to connect to multiple Stellar wallets
 * including Freighter, Albedo, and Lobstr using the stellar-wallets-kit library.
 * 
 * @param horizonUrl - Stellar Horizon server URL (defaults to testnet)
 * @param network - Stellar network passphrase (defaults to testnet)
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { connected, publicKey, balances, connect, disconnect } = useStellarWallet();
 *   
 *   return (
 *     <div>
 *       {connected ? (
 *         <p>Connected: {publicKey}</p>
 *       ) : (
 *         <button onClick={connect}>Connect Wallet</button>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useStellarWallet(
  horizonUrl: string = 'https://horizon-testnet.stellar.org',
  network: string = Networks.TESTNET
): StellarWalletState {
  const [connected, setConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<string>();
  const [walletName, setWalletName] = useState<string>();
  const [balances, setBalances] = useState<Balance[]>([]);
  const [server] = useState(() => new Server(horizonUrl));

  /**
   * Connect to a Stellar wallet using the modal interface
   */
  const connect = useCallback(async () => {
    try {
      await kit.openModal({
        modalTitle: "Connect to your favorite wallet",
        onWalletSelected: async (option: ISupportedWallet) => {
          kit.setWallet(option.id);

          const { address } = await kit.getAddress();
          const { name } = option;

          setPublicKey(address);
          setWalletName(name);
          setConnected(true);
          
          // Save connection to localStorage for persistence
          if (typeof window !== 'undefined') {
            localStorage.setItem('stellar_wallet_connected', 'true');
            localStorage.setItem('stellar_wallet_id', option.id);
            localStorage.setItem('stellar_wallet_address', address);
            localStorage.setItem('stellar_wallet_name', name);
          }
          
          // Load balances inline to avoid circular dependency
          try {
            const account = await server.accounts().accountId(address).call();
            setBalances(account.balances);
          } catch (error: unknown) {
            // Account doesn't exist on the network yet (needs funding)
            if (error && typeof error === 'object' && 'response' in error && (error as { response?: { status?: number } }).response?.status === 404) {
              setBalances([]);
            } else {
              console.error('Failed to load balances:', error);
              setBalances([]);
            }
          }
        },
      });
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      throw error;
    }
  }, [server]);

  /**
   * Disconnect wallet and clear state
   */
  const disconnect = useCallback(async () => {
    try {
      await kit.disconnect();
      setConnected(false);
      setPublicKey(undefined);
      setWalletName(undefined);
      setBalances([]);
      
      // Clear localStorage on disconnect
      if (typeof window !== 'undefined') {
        localStorage.removeItem('stellar_wallet_connected');
        localStorage.removeItem('stellar_wallet_id');
        localStorage.removeItem('stellar_wallet_address');
        localStorage.removeItem('stellar_wallet_name');
      }
    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
    }
  }, []);

  /**
   * Helper function to refresh balances for a given public key
   */
  const refreshBalancesForKey = useCallback(async (key: string) => {
    try {
      const account = await server.accounts().accountId(key).call();
      setBalances(account.balances);
    } catch (error: unknown) {
      // Account doesn't exist on the network yet (needs funding)
      if (error && typeof error === 'object' && 'response' in error && (error as { response?: { status?: number } }).response?.status === 404) {
        setBalances([]);
      } else {
        console.error('Failed to load balances:', error);
        setBalances([]);
      }
    }
  }, [server]);

  /**
   * Refresh account balances from Horizon
   */
  const refreshBalances = useCallback(async () => {
    if (!publicKey) return;
    await refreshBalancesForKey(publicKey);
  }, [publicKey, refreshBalancesForKey]);

  /**
   * Send a payment transaction using the connected wallet
   * 
   * @param opts - Payment options including recipient, amount, asset, memo
   * @returns Transaction result from Horizon
   */
  const sendPayment = useCallback(async (opts: PaymentOptions) => {
    if (!publicKey || !connected) {
      throw new Error('Wallet not connected');
    }

    try {
      // Load sender account
      const account = await server.loadAccount(publicKey);
      
      // Determine asset
      const asset = opts.asset === 'XLM' || !opts.asset 
        ? Asset.native() 
        : new Asset(opts.asset.code, opts.asset.issuer);

      // Build transaction
      const txBuilder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: network,
      });

      // Add payment operation
      txBuilder.addOperation(
        Operation.payment({
          destination: opts.to,
          asset: asset,
          amount: opts.amount,
        })
      );

      // Add memo if provided
      if (opts.memo) {
        txBuilder.addMemo(Memo.text(opts.memo));
      }

      txBuilder.setTimeout(30);
      const transaction = txBuilder.build();

      // Sign transaction using stellar-wallets-kit
      const { signedTxXdr } = await kit.signTransaction(transaction.toXDR(), {
        address: publicKey,
        networkPassphrase: network,
      });

      // Submit to network
      const signedTransaction = TransactionBuilder.fromXDR(signedTxXdr, network);
      const result = await server.submitTransaction(signedTransaction);
      
      await refreshBalances(); // Refresh balances after successful payment
      return result;
    } catch (error) {
      console.error('Payment failed:', error);
      throw error;
    }
  }, [publicKey, connected, server, network, refreshBalances]);

  // Auto-reconnect wallet on mount if previously connected
  useEffect(() => {
    const autoReconnect = async () => {
      if (typeof window === 'undefined') return;
      
      const wasConnected = localStorage.getItem('stellar_wallet_connected');
      const savedWalletId = localStorage.getItem('stellar_wallet_id');
      const savedAddress = localStorage.getItem('stellar_wallet_address');
      const savedName = localStorage.getItem('stellar_wallet_name');
      
      if (wasConnected === 'true' && savedWalletId && savedAddress) {
        try {
          kit.setWallet(savedWalletId);
          const { address } = await kit.getAddress();
          
          if (address === savedAddress) {
            setPublicKey(address);
            setWalletName(savedName || 'Unknown');
            setConnected(true);
            
            try {
              const account = await server.accounts().accountId(address).call();
              setBalances(account.balances);
            } catch (error: unknown) {
              if (error && typeof error === 'object' && 'response' in error && (error as { response?: { status?: number } }).response?.status === 404) {
                setBalances([]);
              } else {
                setBalances([]);
              }
            }
          }
        } catch {
          if (typeof window !== 'undefined') {
            localStorage.removeItem('stellar_wallet_connected');
            localStorage.removeItem('stellar_wallet_id');
            localStorage.removeItem('stellar_wallet_address');
            localStorage.removeItem('stellar_wallet_name');
          }
        }
      }
    };
    
    autoReconnect();
  }, [server]);

  return {
    connected,
    publicKey,
    walletName,
    balances,
    connect,
    disconnect,
    refreshBalances,
    sendPayment: connected ? sendPayment : undefined,
  };
}