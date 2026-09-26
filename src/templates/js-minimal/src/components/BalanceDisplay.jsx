'use client';

import { useWallet } from '../contexts';
import { useStellarBalances } from '../hooks/useStellarBalances';

function formatAmount(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  const decimals = Math.max(2, Math.min(7, raw.split('.')[1]?.replace(/0+$/, '').length ?? 2));
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

function assetLabel(balance) {
  return balance.asset_type === 'native' ? 'XLM' : balance.asset_code ?? 'Unknown';
}

function WalletIcon() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  );
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

/** JavaScript counterpart of the minimal template's BalanceDisplay component. */
export default function BalanceDisplay({ pollIntervalMs, horizonUrl } = {}) {
  const { connected, publicKey } = useWallet();
  const { balances, loading, error, refresh } = useStellarBalances(
    connected ? publicKey : null,
    { pollIntervalMs, horizonUrl },
  );
  const containerClass = 'w-full max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900';

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
        <p className="text-sm text-gray-900 dark:text-gray-100 font-medium">Couldn't load balances</p>
        <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">{error.message}</p>
        <button
          type="button"
          onClick={() => refresh()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
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
      {balances.map((balance, index) => (
        <BalanceRow key={`${balance.asset_type}-${balance.asset_code ?? 'native'}-${index}`} balance={balance} />
      ))}
    </div>
  );
}
