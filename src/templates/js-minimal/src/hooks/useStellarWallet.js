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
import { kit } from '../lib/stellar-wallet-kit';
import { storage } from '../lib/storage';

const Server = Horizon.Server;

/**
 * Custom React hook for Stellar wallet integration using Stellar Wallets Kit
 *
 * This hook provides a clean interface to connect to multiple Stellar wallets
 * including Freighter, Albedo, and Lobstr using the stellar-wallets-kit library.
 *
 * @example
 * ```jsx
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
  horizonUrl = 'https://horizon-testnet.stellar.org',
  network = Networks.TESTNET
) {
  const [connected, setConnected] = useState(false);
  const [publicKey, setPublicKey] = useState();
  const [walletName, setWalletName] = useState();
  const [balances, setBalances] = useState([]);
  const [server] = useState(() => new Server(horizonUrl));

  /**
   * Connect to a Stellar wallet using the modal interface
   */
  const connect = useCallback(async () => {
    try {
      await kit().openModal({
        modalTitle: "Connect to your favorite wallet",
        onWalletSelected: async (option) => {
          kit().setWallet(option.id);

          const { address } = await kit().getAddress();
          const { name } = option;

          setPublicKey(address);
          setWalletName(name);
          setConnected(true);

          storage.set('stellar_wallet_connected', 'true');
          storage.set('stellar_wallet_id', option.id);
          storage.set('stellar_wallet_address', address);
          storage.set('stellar_wallet_name', name);

          // Load balances inline to avoid circular dependency
          try {
            const account = await server.accounts().accountId(address).call();
            setBalances(account.balances);
          } catch (error) {
            // Account doesn't exist on the network yet (needs funding)
            if (error && typeof error === 'object' && 'response' in error && error.response?.status === 404) {
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
      await kit().disconnect();
      setConnected(false);
      setPublicKey(undefined);
      setWalletName(undefined);
      setBalances([]);

      storage.remove('stellar_wallet_connected');
      storage.remove('stellar_wallet_id');
      storage.remove('stellar_wallet_address');
      storage.remove('stellar_wallet_name');
    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
    }
  }, []);

  /**
   * Helper function to refresh balances for a given public key
   */
  const refreshBalancesForKey = useCallback(async (key) => {
    try {
      const account = await server.accounts().accountId(key).call();
      setBalances(account.balances);
    } catch (error) {
      // Account doesn't exist on the network yet (needs funding)
      if (error && typeof error === 'object' && 'response' in error && error.response?.status === 404) {
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
  const sendPayment = useCallback(async (opts) => {
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
      const { signedTxXdr } = await kit().signTransaction(transaction.toXDR(), {
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
      const wasConnected = storage.get('stellar_wallet_connected');
      const savedWalletId = storage.get('stellar_wallet_id');
      const savedAddress = storage.get('stellar_wallet_address');
      const savedName = storage.get('stellar_wallet_name');

      if (wasConnected === 'true' && savedWalletId && savedAddress) {
        try {
          kit().setWallet(savedWalletId);
          const { address } = await kit().getAddress();

          if (address === savedAddress) {
            setPublicKey(address);
            setWalletName(savedName || 'Unknown');
            setConnected(true);

            try {
              const account = await server.accounts().accountId(address).call();
              setBalances(account.balances);
            } catch (error) {
              if (error && typeof error === 'object' && 'response' in error && error.response?.status === 404) {
                setBalances([]);
              } else {
                setBalances([]);
              }
            }
          }
        } catch {
          storage.remove('stellar_wallet_connected');
          storage.remove('stellar_wallet_id');
          storage.remove('stellar_wallet_address');
          storage.remove('stellar_wallet_name');
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
