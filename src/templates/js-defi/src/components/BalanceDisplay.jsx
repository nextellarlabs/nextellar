'use client';

import React from 'react';
import { useWallet } from '../contexts';
import { useStellarBalances } from '../hooks/useStellarBalances';

const WalletIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
  </svg>
);

const AlertIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

const RefreshIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

/** "1234.5670000" -> "1,234.567" — trims trailing zeros but keeps at least 2 decimal places. */
function formatAmount(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  const decimals = Math.max(2, Math.min(7, raw.split('.')[1]?.replace(/0+$/, '').length ?? 2));
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals });
}

function assetLabel(balance) {
  if (balance.asset_type === 'native') return 'XLM';
  return balance.asset_code ?? 'Unknown';
}

function BalanceRow({ balance }) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{assetLabel(balance)}</p>
        {balance.asset_issuer && (
          <p className="text-xs text-gray-600 dark:text-gray-300 font-mono truncate mt-0.5">
            {balance.asset_issuer.slice(0, 4)}...{balance.asset_issuer.slice(-4)}
          </p>
        )}
      </div>
      <div className="flex-shrink-0 text-right">
        <p className="font-medium text-sm tabular-nums text-gray-900 dark:text-gray-100">
          {formatAmount(balance.balance)}
        </p>
        {balance.limit && (
          <p className="text-xs text-gray-600 dark:text-gray-300 tabular-nums">
            Limit: {formatAmount(balance.limit)}
          </p>
        )}
      </div>
    </div>
  );
}

function BalanceRowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-4 p-4 animate-pulse">
      <div className="space-y-2">
        <div className="h-4 w-12 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-3 w-20 rounded bg-gray-200 dark:bg-gray-700" />
      </div>
      <div className="h-4 w-16 rounded bg-gray-200 dark:bg-gray-700 ml-auto" />
    </div>
  );
}

/**
 * Balance Display
 *
 * Renders the connected wallet's native (XLM) and asset balances, wrapping
 * `useStellarBalances`. Handles all four states the hook can be in:
 * disconnected, loading (skeleton rows), error (with retry), and populated.
 *
 * @example
 * <BalanceDisplay />
 * <BalanceDisplay pollIntervalMs={15000} />
 */
export default function BalanceDisplay({ pollIntervalMs, horizonUrl } = {}) {
  const { connected, publicKey } = useWallet();
  const { balances, loading, error, refresh } = useStellarBalances(
    connected ? publicKey : null,
    { pollIntervalMs, horizonUrl },
  );

  const containerClass =
    'w-full max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900';

  if (!connected || !publicKey) {
    return (
      <div className={`${containerClass} p-10 text-center`} role="status">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 mb-4 text-gray-600 dark:text-gray-300">
          <WalletIcon />
        </div>
        <p className="text-gray-600 dark:text-gray-400 text-sm font-medium">Connect a wallet to view balances</p>
      </div>
    );
  }

  if (loading && balances.length === 0) {
    return (
      <div className={containerClass} role="status" aria-label="Loading balances">
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          <BalanceRowSkeleton />
          <BalanceRowSkeleton />
        </div>
        <span className="sr-only">Loading balances...</span>
      </div>
    );
  }

  if (error && balances.length === 0) {
    return (
      <div className={`${containerClass} p-6 text-center`}>
        <div className="text-red-500 mx-auto mb-2 flex justify-center">
          <AlertIcon />
        </div>
        <p className="text-sm text-gray-900 dark:text-gray-100 font-medium">Couldn't load balances</p>
        <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">{error.message}</p>
        <button
          type="button"
          onClick={() => refresh()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          <RefreshIcon />
          Retry
        </button>
      </div>
    );
  }

  if (balances.length === 0) {
    return (
      <div className={`${containerClass} p-10 text-center`} role="status">
        <p className="text-gray-600 dark:text-gray-400 text-sm font-medium">No balances found</p>
        <p className="text-gray-600 dark:text-gray-300 text-xs mt-1">This account may need funding.</p>
      </div>
    );
  }

  return (
    <div className={`${containerClass} divide-y divide-gray-100 dark:divide-gray-800`}>
      {balances.map((balance, i) => (
        <BalanceRow key={`${balance.asset_type}-${balance.asset_code ?? 'native'}-${i}`} balance={balance} />
      ))}
    </div>
  );
}
