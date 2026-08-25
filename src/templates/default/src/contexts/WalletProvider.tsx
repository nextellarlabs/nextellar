'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import {
  Horizon,
  TransactionBuilder,
  Operation,
  Networks,
  Asset,
  Memo,
  BASE_FEE
} from '@stellar/stellar-sdk';
import { ISupportedWallet, WalletNetwork } from "@creit.tech/stellar-wallets-kit";
import { kit } from '../lib/stellar-wallet-kit';
import { NETWORKS } from '../config/networks';
import { storage } from '../lib/storage';

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
  secret?: string;
}

/**
 * Account interface for multi-account support
 */
export interface WalletAccount {
  address: string;
  displayName?: string;
}

/**
 * Wallet context state
 */
interface WalletContextState {
  connected: boolean;
  publicKey?: string;
  walletName?: string;
  balances: Balance[];
  accounts: WalletAccount[];
  currentAccountIndex: number;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
  switchAccount: (address: string) => Promise<void>;
  sendPayment?: (opts: PaymentOptions) => Promise<Horizon.HorizonApi.SubmitTransactionResponse>;
}

/**
 * Wallet config context - exposes provider settings to hooks
 */
interface WalletConfigContextState {
  activeNetworkKey: string;
  horizonUrl: string;
  sorobanUrl: string;
  network: string;
  switchNetwork: (networkKey: string) => void;
}

/**
 * Wallet provider props
 */
interface WalletProviderProps {
  children: ReactNode;
  horizonUrl?: string;
  sorobanUrl?: string;
  network?: string;
}

// Create contexts
export const WalletContext = createContext<WalletContextState | undefined>(undefined);
export const WalletConfigContext = createContext<WalletConfigContextState | undefined>(undefined);

/**
 * Wallet Provider Component
 * 
 * Wraps your app to provide wallet functionality throughout the component tree.
 * Handles wallet connection, persistence, and state management.
 * 
 * @example
 * ```tsx
 * // In your app layout or root
 * <WalletProvider>
 *   <YourApp />
 * </WalletProvider>
 * ```
 */
export function WalletProvider({
  children,
  horizonUrl: initialHorizonUrl = process.env.NEXT_PUBLIC_HORIZON_URL || 'https://horizon-testnet.stellar.org',
  sorobanUrl: initialSorobanUrl = process.env.NEXT_PUBLIC_SOROBAN_URL || 'https://soroban-testnet.stellar.org',
  network: initialNetwork = (process.env.NEXT_PUBLIC_NETWORK === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET)
}: WalletProviderProps) {
  const [activeNetworkKey, setActiveNetworkKey] = useState<string>('testnet');
  const [connected, setConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<string>();
  const [walletName, setWalletName] = useState<string>();
  const [balances, setBalances] = useState<Balance[]>([]);
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [currentAccountIndex, setCurrentAccountIndex] = useState(0);

  // Load saved network on mount
  useEffect(() => {
    const savedNetwork = storage.get('stellar_network');
    if (savedNetwork && NETWORKS[savedNetwork]) {
      setActiveNetworkKey(savedNetwork);
    }
  }, []);

  // Derive active settings from config or props
  const config = NETWORKS[activeNetworkKey] || NETWORKS.testnet;
  const activeHorizonUrl = initialHorizonUrl || config.horizonUrl;
  const activeSorobanUrl = initialSorobanUrl || config.sorobanUrl;
  const activeNetworkPassphrase = initialNetwork || config.passphrase;

  const [server, setServer] = useState(() => new Server(activeHorizonUrl));
  const serverRef = useRef(server);

  // Update server when the active Horizon URL changes.
  useEffect(() => {
    const nextServer = new Server(activeHorizonUrl);
    setServer(nextServer);
    serverRef.current = nextServer;
  }, [activeHorizonUrl]);

  /**
   * Helper function to save accounts to storage
   */
  const saveAccountsToStorage = useCallback((accts: WalletAccount[], currentIndex: number) => {
    storage.set('stellar_wallet_accounts', JSON.stringify(accts));
    storage.set('stellar_wallet_current_account_index', currentIndex.toString());
  }, []);

  /**
   * Helper function to load accounts from storage
   */
  const loadAccountsFromStorage = useCallback(() => {
    const saved = storage.get('stellar_wallet_accounts');
    const savedIndex = storage.get('stellar_wallet_current_account_index');
    if (saved) {
      try {
        const accts = JSON.parse(saved) as WalletAccount[];
        const index = savedIndex ? parseInt(savedIndex, 10) : 0;
        return { accounts: accts, index: Math.max(0, Math.min(index, accts.length - 1)) };
      } catch {
        return { accounts: [], index: 0 };
      }
    }
    return { accounts: [], index: 0 };
  }, []);

  /**
   * Connect to a Stellar wallet using the modal interface
   */
  const connect = useCallback(async () => {
    try {
      // Get fresh kit instance (handles dynamic options)
      const walletNetwork = activeNetworkKey === 'mainnet' ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET;
      const currentKit = kit(walletNetwork);

      await currentKit.openModal({
        modalTitle: "Connect to your favorite wallet",
        onWalletSelected: async (option: ISupportedWallet) => {
          currentKit.setWallet(option.id);

          const { address } = await currentKit.getAddress();
          const { name } = option;

          // Create or update account list
          const newAccount: WalletAccount = {
            address,
            displayName: `${name} - ${address.slice(0, 6)}...${address.slice(-6)}`,
          };

          setPublicKey(address);
          setWalletName(name);
          setConnected(true);

          // Check if account already exists in list
          setAccounts((prevAccounts) => {
            const existingIndex = prevAccounts.findIndex((acc) => acc.address === address);
            let updatedAccounts: WalletAccount[];
            let newIndex: number;

            if (existingIndex >= 0) {
              // Account already exists, switch to it
              updatedAccounts = prevAccounts;
              newIndex = existingIndex;
            } else {
              // New account, add to list
              updatedAccounts = [...prevAccounts, newAccount];
              newIndex = updatedAccounts.length - 1;
            }

            setCurrentAccountIndex(newIndex);
            saveAccountsToStorage(updatedAccounts, newIndex);
            return updatedAccounts;
          });

          storage.set('stellar_wallet_connected', 'true');
          storage.set('stellar_wallet_id', option.id);
          storage.set('stellar_wallet_address', address);
          storage.set('stellar_wallet_name', name);

          // Load balances
          try {
            const account = await serverRef.current.accounts().accountId(address).call();
            setBalances(account.balances);
          } catch (error: unknown) {
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
  }, [activeNetworkKey, saveAccountsToStorage]);

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
      setAccounts([]);
      setCurrentAccountIndex(0);

      storage.remove('stellar_wallet_connected');
      storage.remove('stellar_wallet_id');
      storage.remove('stellar_wallet_address');
      storage.remove('stellar_wallet_name');
      storage.remove('stellar_wallet_accounts');
      storage.remove('stellar_wallet_current_account_index');
    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
    }
  }, []);

  /**
   * Switch to a different account in the accounts list
   */
  const switchAccount = useCallback(
    async (address: string) => {
      const accountIndex = accounts.findIndex((acc) => acc.address === address);
      if (accountIndex < 0) {
        console.error('Account not found:', address);
        return;
      }

      setPublicKey(address);
      setCurrentAccountIndex(accountIndex);
      saveAccountsToStorage(accounts, accountIndex);

      // Update storage with new active address
      storage.set('stellar_wallet_address', address);

      // Load balances for the new account
      try {
        const account = await serverRef.current.accounts().accountId(address).call();
        setBalances(account.balances);
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'response' in error && (error as { response?: { status?: number } }).response?.status === 404) {
          setBalances([]);
        } else {
          console.error('Failed to load balances for account:', error);
          setBalances([]);
        }
      }
    },
    [accounts, saveAccountsToStorage]
  );

  /**
   * Switch the active network.
   */
  const switchNetwork = useCallback((networkKey: string) => {
    if (!NETWORKS[networkKey]) return;
    
    // Changing network requires disconnecting the current session
    // since accounts and balances are network-specific.
    if (connected) {
      disconnect();
    }
    
    storage.set('stellar_network', networkKey);
    setActiveNetworkKey(networkKey);
  }, [connected, disconnect]);

  /**
   * Refresh balances for the connected wallet
   */
  const refreshBalances = useCallback(async () => {
    if (!publicKey) return;

    try {
      const account = await serverRef.current.accounts().accountId(publicKey).call();
      setBalances(account.balances);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'response' in error && (error as { response?: { status?: number } }).response?.status === 404) {
        setBalances([]);
      } else {
        console.error('Failed to load balances:', error);
        setBalances([]);
      }
    }
  }, [publicKey]);

  /**
   * Send a payment transaction
   */
  const sendPayment = useCallback(async (opts: PaymentOptions): Promise<Horizon.HorizonApi.SubmitTransactionResponse> => {
    if (!publicKey || !connected) {
      throw new Error('Wallet not connected');
    }

    try {
      const account = await serverRef.current.loadAccount(publicKey);
      const asset = opts.asset === 'XLM' || !opts.asset
        ? Asset.native()
        : new Asset(opts.asset.code, opts.asset.issuer);

      const txBuilder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: activeNetworkPassphrase,
      }).addOperation(
        Operation.payment({
          destination: opts.to,
          asset,
          amount: opts.amount,
        })
      );

      if (opts.memo) {
        txBuilder.addMemo(Memo.text(opts.memo));
      }

      const transaction = txBuilder.setTimeout(30).build();

      let signedTxXdr: string;
      if (opts.secret) {
        // DEV-ONLY: Sign with secret key
        const { Keypair } = await import('@stellar/stellar-sdk');
        const keypair = Keypair.fromSecret(opts.secret);
        transaction.sign(keypair);
        signedTxXdr = transaction.toXDR();
      } else {
        // Sign with wallet
        const { signTransaction } = await import('../lib/stellar-wallet-kit');
        signedTxXdr = await signTransaction({
          unsignedTransaction: transaction.toXDR(),
          address: publicKey,
        });
      }

      const signedTransaction = TransactionBuilder.fromXDR(signedTxXdr, activeNetworkPassphrase);
      const result = await serverRef.current.submitTransaction(signedTransaction);

      await refreshBalances();
      return result;
    } catch (error) {
      console.error('Payment failed:', error);
      throw error;
    }
  }, [publicKey, connected, activeNetworkPassphrase, refreshBalances]);

  // Auto-reconnect wallet on mount if previously connected
  useEffect(() => {
    const autoReconnect = async () => {
      const wasConnected = storage.get('stellar_wallet_connected');
      const savedWalletId = storage.get('stellar_wallet_id');
      const savedAddress = storage.get('stellar_wallet_address');
      const savedName = storage.get('stellar_wallet_name');

      if (wasConnected === 'true' && savedWalletId && savedAddress) {
        try {
          const walletNetwork = activeNetworkKey === 'mainnet' ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET;
          const currentKit = kit(walletNetwork);
          currentKit.setWallet(savedWalletId);
          const { address } = await currentKit.getAddress();

          if (address === savedAddress) {
            setPublicKey(address);
            setWalletName(savedName || 'Unknown');
            setConnected(true);

            // Load saved accounts or create new account list
            const { accounts: savedAccounts, index: savedIndex } = loadAccountsFromStorage();
            if (savedAccounts.length > 0) {
              setAccounts(savedAccounts);
              setCurrentAccountIndex(savedIndex);
            } else {
              // Create initial account list if none saved
              const newAccounts: WalletAccount[] = [
                {
                  address,
                  displayName: `${savedName} - ${address.slice(0, 6)}...${address.slice(-6)}`,
                },
              ];
              setAccounts(newAccounts);
              setCurrentAccountIndex(0);
              saveAccountsToStorage(newAccounts, 0);
            }

            try {
              const account = await serverRef.current.accounts().accountId(address).call();
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
          storage.remove('stellar_wallet_connected');
          storage.remove('stellar_wallet_id');
          storage.remove('stellar_wallet_address');
          storage.remove('stellar_wallet_name');
          storage.remove('stellar_wallet_accounts');
          storage.remove('stellar_wallet_current_account_index');
        }
      }
    };

    autoReconnect();
  }, [activeNetworkKey, loadAccountsFromStorage, saveAccountsToStorage]);

  const walletValue: WalletContextState = {
    connected,
    publicKey,
    walletName,
    balances,
    accounts,
    currentAccountIndex,
    connect,
    disconnect,
    refreshBalances,
    switchAccount,
    sendPayment: connected ? sendPayment : undefined,
  };

  const configValue: WalletConfigContextState = {
    activeNetworkKey,
    horizonUrl: activeHorizonUrl,
    sorobanUrl: activeSorobanUrl,
    network: activeNetworkPassphrase,
    switchNetwork,
  };

  return (
    <WalletConfigContext.Provider value={configValue}>
      <WalletContext.Provider value={walletValue}>
        {children}
      </WalletContext.Provider>
    </WalletConfigContext.Provider>
  );
}

/**
 * Hook to use wallet context
 * 
 * Must be used within a WalletProvider
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { connected, publicKey, connect, disconnect } = useWallet();
 *   
 *   return (
 *     <div>
 *       {connected ? (
 *         <div>
 *           <p>Connected: {publicKey}</p>
 *           <button onClick={disconnect}>Disconnect</button>
 *         </div>
 *       ) : (
 *         <button onClick={connect}>Connect Wallet</button>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useWallet(): WalletContextState {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}

/**
 * Hook to access wallet provider configuration
 * 
 * Use this in standalone hooks to consume the provider's horizonUrl and network settings.
 * Returns undefined if not within a WalletProvider (allows standalone usage).
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const config = useWalletConfig();
 *   const balances = useStellarBalances({ 
 *     horizonUrl: config?.horizonUrl // Falls back to the hook's default if no provider
 *   });
 * }
 * ```
 */
export function useWalletConfig(): WalletConfigContextState | undefined {
  return useContext(WalletConfigContext);
}
