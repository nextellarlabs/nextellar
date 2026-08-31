'use client';

import { AlertCircle, RefreshCw, Wallet } from 'lucide-react';
import { useWallet } from '../contexts';
import { useStellarBalances, type Balance } from '../hooks/useStellarBalances';

export interface BalanceDisplayProps {
  /** Poll interval in ms; passed straight through to useStellarBalances. Unset = no polling. */
  pollIntervalMs?: number;
  /** Override the Horizon URL useStellarBalances resolves to (falls back to wallet config, then testnet). */
  horizonUrl?: string;
}

/** "1234.5670000" -> "1,234.567" — trims trailing zeros but keeps at least 2 decimal places. */
function formatAmount(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  const decimals = Math.max(2, Math.min(7, raw.split('.')[1]?.replace(/0+$/, '').length ?? 2));
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals });
}

function assetLabel(balance: Balance): string {
  if (balance.asset_type === 'native') return 'XLM';
  return balance.asset_code ?? 'Unknown';
}

function BalanceRow({ balance }: { balance: Balance }) {
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
export default function BalanceDisplay({ pollIntervalMs, horizonUrl }: BalanceDisplayProps) {
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
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
          <Wallet className="w-6 h-6 text-gray-600 dark:text-gray-300" aria-hidden="true" />
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
        <AlertCircle className="w-6 h-6 text-red-500 mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm text-gray-900 dark:text-gray-100 font-medium">Couldn't load balances</p>
        <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">{error.message}</p>
        <button
          type="button"
          onClick={() => refresh()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
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
