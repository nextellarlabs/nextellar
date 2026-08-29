'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '../contexts';
import { useStellarBalances, type Balance } from '../hooks/useStellarBalances';
import { SkeletonList } from './Skeleton';

function assetLabel(balance: Balance): string {
  return balance.asset_type === 'native' ? 'XLM' : balance.asset_code ?? 'Asset';
}

export default function BalanceDisplay() {
  const [mounted, setMounted] = useState(false);
  const { connected, publicKey } = useWallet();
  const { balances, loading, error, refresh } = useStellarBalances(publicKey);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  if (!connected) {
    return (
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4" role="status">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Connect wallet</p>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          Balances will appear after your wallet is connected.
        </p>
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useWallet } from '../contexts';
import { useStellarBalances, type Balance } from '../hooks/useStellarBalances';
import { Skeleton, SkeletonList } from './Skeleton';
import EmptyState, { NoWalletIcon } from './EmptyState';

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

  if (!connected || !publicKey) {
    return (
      <div className="w-full max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <EmptyState icon={<NoWalletIcon />} title="Connect a wallet to view balances" />
      </div>
    );
  }

  if (loading && balances.length === 0) {
    return <SkeletonList rows={3} label="Loading account balances" />;
    return (
      <div className="w-full max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <SkeletonList rows={2} label="Loading balances" renderRow={() => <BalanceRowSkeleton />} />
      </div>
    );
  }

  if (error && balances.length === 0) {
    return (
      <div className="rounded-2xl border border-red-200 dark:border-red-900/40 p-4" role="alert">
        <p className="text-sm font-medium text-red-700 dark:text-red-300">
          Failed to load balances
        </p>
        <p className="mt-1 text-xs text-red-600 dark:text-red-300">{error.message}</p>
        <button
          type="button"
          onClick={refresh}
          className="mt-3 rounded-full border border-red-200 px-3 py-1 text-xs font-medium text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
        >
      <div className="w-full max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 text-center">
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

  return (
    <section
      className="rounded-2xl border border-gray-200 dark:border-gray-800"
      aria-labelledby="balance-display-heading"
    >
      <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <h2 id="balance-display-heading" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Balances
        </h2>
      </div>
      {balances.length === 0 ? (
        <p className="p-4 text-sm text-gray-600 dark:text-gray-300">No balances found.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800" aria-label="Account balances">
          {balances.map((balance, index) => (
            <li key={`${assetLabel(balance)}-${balance.asset_issuer ?? 'native'}-${index}`} className="flex items-center justify-between gap-4 p-4">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {assetLabel(balance)}
              </span>
              <span className="font-mono text-sm tabular-nums text-gray-700 dark:text-gray-200">
                {balance.balance}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  if (balances.length === 0) {
    return (
      <div className="w-full max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <EmptyState title="No balances found" description="This account may need funding." />
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800">
      {balances.map((balance, i) => (
        <BalanceRow key={`${balance.asset_type}-${balance.asset_code ?? 'native'}-${i}`} balance={balance} />
      ))}
    </div>
  );
}

function BalanceRowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="space-y-2">
        <Skeleton width="w-12" />
        <Skeleton width="w-20" height="h-3" />
      </div>
      <Skeleton width="w-16" className="ml-auto" />
    </div>
  );
}
