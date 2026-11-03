'use client';

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useWallet, type WalletOption } from '../contexts';
import { useStellarBalances } from '../hooks/useStellarBalances';
import AccountSwitcher from './AccountSwitcher';
import WalletSelectModal from './WalletSelectModal';
import DisconnectConfirmDialog from './DisconnectConfirmDialog';

// Simple inline SVG icons
const WalletIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
  </svg>
);

const LoaderIcon = () => (
  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

const RefreshIcon = ({ spinning = false }: { spinning?: boolean }) => (
  <svg
    className={`w-4 h-4 ${spinning ? 'animate-spin' : ''}`}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

interface WalletConnectButtonProps {
  theme?: 'light' | 'dark';
  /**
   * Which wallet picker "Connect Wallet" opens (#911):
   * - 'kit' (default): the wallet kit's own modal, unchanged behaviour
   * - 'builtin': this template's `WalletSelectModal`, listing each wallet's
   *   icon and name with full keyboard support
   */
  walletSelector?: 'kit' | 'builtin';
  /**
   * Ask for confirmation before disconnecting (#910). Off by default so
   * existing integrations keep their one-click disconnect.
   */
  confirmDisconnect?: boolean;
}

/**
 * Wallet Connect Button with Account Switcher
 * 
 * A clean, reusable button component that integrates with Stellar wallets.
 * When connected, displays the current account and provides a dropdown
 * to switch between multiple connected accounts.
 * Follows the same design system as the main CTA buttons.
 */
export default function WalletConnectButton({
  theme = 'light',
  walletSelector = 'kit',
  confirmDisconnect = false,
}: WalletConnectButtonProps) {
  const { connected, connect, disconnect, walletName, accounts, publicKey, getWallets, reconnecting } =
    useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [wallets, setWallets] = useState<WalletOption[] | null>(null);
  const [walletsError, setWalletsError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const {
    loading: isRefreshing,
    refresh: refreshBalances,
  } = useStellarBalances(connected ? publicKey : null);
  const actionLabel = connected
    ? `Disconnect ${walletName ?? 'wallet'}`
    : 'Connect Wallet';

  const runWalletAction = async (action: () => Promise<void> | void) => {
    setIsLoading(true);
    setError(null);
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Wallet operation failed';
      setError(message);
      console.error('Wallet operation failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const openWalletSelector = async () => {
    setError(null);
    setWallets(null);
    setWalletsError(null);
    setSelectorOpen(true);
    try {
      setWallets(await getWallets!());
    } catch (error) {
      setWalletsError(error instanceof Error ? error.message : 'Could not load wallets');
    }
  };

  const handleClick = async () => {
    if (connected) {
      if (confirmDisconnect) {
        setConfirmOpen(true);
        return;
      }
      await runWalletAction(() => disconnect());
      return;
    }
    // Fall back to the kit modal when the provider can't list wallets (e.g.
    // an older provider or a hand-built context value).
    if (walletSelector === 'builtin' && getWallets) {
      await openWalletSelector();
      return;
    }
    await runWalletAction(() => connect());
  };

  const handleWalletSelected = async (walletId: string) => {
    setSelectorOpen(false);
    await runWalletAction(() => connect(walletId));
  };

  const handleConfirmDisconnect = async () => {
    setConfirmOpen(false);
    await runWalletAction(() => disconnect());
  };

  const getButtonText = () => {
    if (reconnecting && !connected) return 'Reconnecting...';
    if (isLoading) return connected ? 'Disconnecting...' : 'Connecting...';
    if (connected) return `Disconnect ${walletName}`;
    return 'Connect Wallet';
  };

  const getIcon = () => {
    if (isLoading) return <LoaderIcon />;
    return <WalletIcon />;
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex items-center gap-3">
      <button 
        type="button"
        onClick={handleClick}
        disabled={isLoading || (reconnecting && !connected)}
        aria-label={reconnecting && !connected ? 'Reconnecting...' : isLoading ? (connected ? 'Disconnecting...' : 'Connecting...') : actionLabel}
        aria-busy={isLoading || (reconnecting && !connected)}
        className={`px-8 py-3 font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
          theme === 'light' 
            ? 'bg-black text-white hover:bg-gray-800 focus-visible:ring-gray-900 focus-visible:ring-offset-white' 
            : 'bg-white text-black hover:bg-gray-200 focus-visible:ring-white focus-visible:ring-offset-gray-950'
        } ${isLoading ? 'opacity-75 cursor-not-allowed' : ''}`}
      >
        <span className="flex items-center gap-2">
          {getIcon()}
          {getButtonText()}
        </span>
      </button>
      
      {connected && (
        <button
          type="button"
          onClick={() => refreshBalances()}
          disabled={isRefreshing}
          aria-label={isRefreshing ? 'Refreshing balances' : 'Refresh balances'}
          aria-busy={isRefreshing}
          title="Refresh balances"
          className={`p-2 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
            theme === 'light'
              ? 'text-gray-700 hover:bg-gray-100 focus-visible:ring-gray-900 focus-visible:ring-offset-white'
              : 'text-gray-200 hover:bg-white/10 focus-visible:ring-white focus-visible:ring-offset-gray-950'
          } ${isRefreshing ? 'opacity-75 cursor-not-allowed' : ''}`}
        >
          <RefreshIcon spinning={isRefreshing} />
        </button>
      )}

      {connected && accounts.length > 0 && <AccountSwitcher />}
      </div>
      <WalletSelectModal
        open={selectorOpen}
        wallets={wallets}
        error={walletsError}
        theme={theme}
        onSelect={handleWalletSelected}
        onClose={() => setSelectorOpen(false)}
      />
      <DisconnectConfirmDialog
        open={confirmOpen}
        walletName={walletName}
        theme={theme}
        onConfirm={handleConfirmDisconnect}
        onCancel={() => setConfirmOpen(false)}
      />
      {error && (
        <div role="alert" className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={handleClick} disabled={isLoading} className="underline font-medium">
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
