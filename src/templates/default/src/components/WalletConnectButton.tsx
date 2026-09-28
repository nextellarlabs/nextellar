'use client';

import { useState } from 'react';
import { useWallet } from '../contexts';
import { useStellarBalances } from '../hooks/useStellarBalances';
import AccountSwitcher from './AccountSwitcher';

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
}

/**
 * Wallet Connect Button with Account Switcher
 * 
 * A clean, reusable button component that integrates with Stellar wallets.
 * When connected, displays the current account and provides a dropdown
 * to switch between multiple connected accounts.
 * Follows the same design system as the main CTA buttons.
 */
export default function WalletConnectButton({ theme = 'light' }: WalletConnectButtonProps) {
  const { connected, connect, disconnect, walletName, accounts, publicKey } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const {
    loading: isRefreshing,
    refresh: refreshBalances,
  } = useStellarBalances(connected ? publicKey : null);
  const actionLabel = connected
    ? `Disconnect ${walletName ?? 'wallet'}`
    : 'Connect Stellar wallet';

  const handleClick = async () => {
    setIsLoading(true);
    try {
      if (connected) {
        await disconnect();
      } else {
        await connect();
      }
    } catch (error) {
      console.error('Wallet operation failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getButtonText = () => {
    if (isLoading) return connected ? 'Disconnecting...' : 'Connecting...';
    if (connected) return `Disconnect ${walletName}`;
    return 'Connect Wallet';
  };

  const getIcon = () => {
    if (isLoading) return <LoaderIcon />;
    return <WalletIcon />;
  };

  return (
    <div className="flex items-center gap-3">
      <button 
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        aria-label={isLoading ? `${actionLabel} in progress` : actionLabel}
        aria-busy={isLoading}
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
  );
}
