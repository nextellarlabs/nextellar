'use client';

import { useState } from 'react';
import { useWallet } from '../contexts';

// Simple inline SVG icons
const WalletIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
  </svg>
);

const LoaderIcon = () => (
  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

interface WalletConnectButtonProps {
  theme?: 'light' | 'dark';
}

/**
 * Simple Wallet Connect Button - Matches the "Deploy to Stellar" button style
 * 
 * A clean, reusable button component that integrates with Stellar wallets.
 * Follows the same design system as the main CTA buttons.
 */
export default function WalletConnectButton({ theme = 'light' }: WalletConnectButtonProps) {
  const { connected, connect, disconnect, walletName } = useWallet();
  const [isLoading, setIsLoading] = useState(false);

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
    <button 
      onClick={handleClick}
      disabled={isLoading}
      className={`px-8 py-3 font-medium rounded-full transition-colors ${
        theme === 'light' 
          ? 'bg-black text-white hover:bg-gray-800' 
          : 'bg-white text-black hover:bg-gray-200'
      } ${isLoading ? 'opacity-75 cursor-not-allowed' : ''}`}
    >
      <span className="flex items-center gap-2">
        {getIcon()}
        {getButtonText()}
      </span>
    </button>
  );
}