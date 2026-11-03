'use client';
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { Horizon, TransactionBuilder, Operation, Networks, Asset, Memo, BASE_FEE } from '@stellar/stellar-sdk';
import { WalletNetwork } from '@creit.tech/stellar-wallets-kit';
import { kit } from '../lib/stellar-wallet-kit';
import { storage } from '../lib/storage.js';
import { NETWORKS } from '../config/networks';

const Server = Horizon.Server;

// Create contexts
export const WalletContext = createContext(undefined);
export const WalletConfigContext = createContext(undefined);

/**
 * Wallet Provider Component
 *
 * Wraps your app to provide wallet functionality throughout the component tree.
 * Handles wallet connection, network switching, persistence, and state management.
 *
 * @example
 * ```jsx
 * // In your app layout or root
 * <WalletProvider>
 *   <YourApp />
 * </WalletProvider>
 * ```
 */
export function WalletProvider({
    children,
    // These fall back only as far as the env vars on purpose (#797): a
    // hardcoded testnet default here always won over the per-network config
    // below, so switching to mainnet kept building and signing transactions
    // for testnet. The per-network defaults live in NETWORKS.
    horizonUrl: initialHorizonUrl = process.env.NEXT_PUBLIC_HORIZON_URL,
    sorobanUrl: initialSorobanUrl = process.env.NEXT_PUBLIC_SOROBAN_URL,
    network: initialNetwork = (process.env.NEXT_PUBLIC_NETWORK === 'PUBLIC' ? Networks.PUBLIC : undefined),
}) {
    const [activeNetworkKey, setActiveNetworkKey] = useState('testnet');
    const [connected, setConnected] = useState(false);
    const [publicKey, setPublicKey] = useState();
    const [walletName, setWalletName] = useState();
    const [balances, setBalances] = useState([]);

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
    // The wallet-kit network matching the active network, used both to
    // (re)build the kit and when signing.
    const activeWalletNetwork = activeNetworkKey === 'mainnet' ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET;

    const [server, setServer] = useState(() => new Server(activeHorizonUrl));
    const serverRef = useRef(server);

    // Update server when the active Horizon URL changes.
    useEffect(() => {
        const nextServer = new Server(activeHorizonUrl);
        setServer(nextServer);
        serverRef.current = nextServer;
    }, [activeHorizonUrl]);

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
                onWalletSelected: async (option) => {
                    currentKit.setWallet(option.id);
                    const { address } = await currentKit.getAddress();
                    const { name } = option;
                    setPublicKey(address);
                    setWalletName(name);
                    setConnected(true);
                    storage.set('stellar_wallet_connected', 'true');
                    storage.set('stellar_wallet_id', option.id);
                    storage.set('stellar_wallet_address', address);
                    storage.set('stellar_wallet_name', name);
                    // Load balances
                    try {
                        const account = await serverRef.current.accounts().accountId(address).call();
                        setBalances(account.balances);
                    }
                    catch (error) {
                        if (error && typeof error === 'object' && 'response' in error && error.response?.status === 404) {
                            setBalances([]);
                        }
                        else {
                            console.error('Failed to load balances:', error);
                            setBalances([]);
                        }
                    }
                },
            });
        }
        catch (error) {
            console.error('Failed to connect wallet:', error);
            throw error;
        }
    }, [activeNetworkKey]);

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
        }
        catch (error) {
            console.error('Failed to disconnect wallet:', error);
        }
    }, []);

    /**
     * Switch the active network.
     */
    const switchNetwork = useCallback((networkKey) => {
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
        }
        catch (error) {
            if (error && typeof error === 'object' && 'response' in error && error.response?.status === 404) {
                setBalances([]);
            }
            else {
                console.error('Failed to load balances:', error);
                setBalances([]);
            }
        }
    }, [publicKey]);

    /**
     * Send a payment transaction
     */
    const sendPayment = useCallback(async (opts) => {
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
            }).addOperation(Operation.payment({
                destination: opts.to,
                asset,
                amount: opts.amount,
            }));
            if (opts.memo) {
                txBuilder.addMemo(Memo.text(opts.memo));
            }
            const transaction = txBuilder.setTimeout(30).build();
            let signedTxXdr;
            if (opts.secret) {
                // DEV-ONLY: Sign with secret key
                const { Keypair } = await import('@stellar/stellar-sdk');
                const keypair = Keypair.fromSecret(opts.secret);
                transaction.sign(keypair);
                signedTxXdr = transaction.toXDR();
            }
            else {
                // Sign with wallet
                const { signTransaction } = await import('../lib/stellar-wallet-kit');
                // Pass the active network so a kit created before a network
                // switch is re-pointed, and the wallet signs for the same
                // passphrase the transaction was built with (#797).
                signedTxXdr = await signTransaction({
                    unsignedTransaction: transaction.toXDR(),
                    address: publicKey,
                    network: activeWalletNetwork,
                    networkPassphrase: activeNetworkPassphrase,
                });
            }
            const signedTransaction = TransactionBuilder.fromXDR(signedTxXdr, activeNetworkPassphrase);
            const result = await serverRef.current.submitTransaction(signedTransaction);
            await refreshBalances();
            return result;
        }
        catch (error) {
            console.error('Payment failed:', error);
            throw error;
        }
    }, [publicKey, connected, activeNetworkPassphrase, activeWalletNetwork, refreshBalances]);

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
                        try {
                            const account = await serverRef.current.accounts().accountId(address).call();
                            setBalances(account.balances);
                        }
                        catch (error) {
                            if (error && typeof error === 'object' && 'response' in error && error.response?.status === 404) {
                                setBalances([]);
                            }
                            else {
                                setBalances([]);
                            }
                        }
                    }
                }
                catch {
                    storage.remove('stellar_wallet_connected');
                    storage.remove('stellar_wallet_id');
                    storage.remove('stellar_wallet_address');
                    storage.remove('stellar_wallet_name');
                }
            }
        };
        autoReconnect();
    }, [activeNetworkKey]);

    const walletValue = {
        connected,
        publicKey,
        walletName,
        balances,
        connect,
        disconnect,
        refreshBalances,
        sendPayment: connected ? sendPayment : undefined,
        switchNetwork,
        activeNetworkKey,
    };

    const configValue = {
        activeNetworkKey,
        horizonUrl: activeHorizonUrl,
        sorobanUrl: activeSorobanUrl,
        network: activeNetworkPassphrase,
        switchNetwork,
    };

    return (<WalletConfigContext.Provider value={configValue}>
        <WalletContext.Provider value={walletValue}>
            {children}
        </WalletContext.Provider>
    </WalletConfigContext.Provider>);
}

/**
 * Hook to use wallet context
 *
 * Must be used within a WalletProvider
 *
 * @example
 * ```jsx
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
export function useWallet() {
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
 * ```jsx
 * function MyComponent() {
 *   const config = useWalletConfig();
 *   const balances = useStellarBalances({
 *     horizonUrl: config?.horizonUrl // Falls back to hook's default if no provider
 *   });
 * }
 * ```
 */
export function useWalletConfig() {
    return useContext(WalletConfigContext);
}
