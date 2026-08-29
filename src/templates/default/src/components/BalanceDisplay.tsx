'use client';

import { AlertCircle, Coins, RefreshCw, Wallet } from 'lucide-react';
import { useWallet } from '../contexts';
import { useStellarBalances, type Balance } from '../hooks/useStellarBalances';
import { SkeletonList } from './Skeleton';
import EmptyState from './EmptyState';

export interface BalanceDisplayProps {
  /**
   * Account to display balances for. Defaults to the connected wallet's
   * public key, so the common case needs no props at all.
   */
  publicKey?: string;
  /** Poll interval in ms. Omit to fetch once; the hook floors this at 5s. */
  pollIntervalMs?: number | null;
  /** Overrides the Horizon endpoint; defaults to the wallet provider's. */
  horizonUrl?: string;
  /** Extra classes merged onto the component root, for layout composition. */
  className?: string;
}

/** The native asset has no code or issuer of its own — Horizon reports it as 'native'. */
function assetCode(balance: Balance): string {
  return balance.asset_type === 'native' ? 'XLM' : (balance.asset_code ?? 'Unknown');
}

/**
 * Formats a Horizon balance string for display.
 *
 * Horizon returns 7-decimal strings ("10.0000000"), which is noise for most
 * balances. Trailing zeros are trimmed but at least two decimals are kept so
 * amounts still read as currency. Parsing is deliberately tolerant: an
 * unparseable value falls back to the raw string rather than rendering NaN.
 */
function formatBalance(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  });
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
 * Renders the native XLM balance alongside any credit assets (trustlines)
 * held by an account, wrapping `useStellarBalances` so a consumer gets
 * loading, empty, and error handling without wiring the hook themselves.
 *
 * The native balance is pulled out and shown first as the headline figure —
 * it is the one every account has, and Horizon does not guarantee its
 * position in the balances array. Remaining assets are listed beneath it.
 *
 * Every state has a light and dark variant, and each is announced correctly:
 * loading and empty are `role="status"`, errors are `role="alert"` with a
 * retry that re-runs the fetch.
 *
 * @example
 * ```tsx
 * // Connected wallet, fetched once.
 * <BalanceDisplay />
 *
 * // A specific account, refreshed every 10 seconds.
 * <BalanceDisplay publicKey={address} pollIntervalMs={10_000} />
 * ```
 */
export default function BalanceDisplay({
  publicKey,
  pollIntervalMs,
  horizonUrl,
  className = '',
}: BalanceDisplayProps) {
  const { connected, publicKey: walletPublicKey } = useWallet();
  const address = publicKey ?? walletPublicKey;

  const { balances, loading, error, refresh } = useStellarBalances(address, {
    ...(horizonUrl ? { horizonUrl } : {}),
    pollIntervalMs,
  });

  // No account to query at all — distinct from "queried and found nothing".
  if (!address) {
    return (
      <div className={className}>
        <EmptyState
          icon={<Wallet className="w-6 h-6 text-gray-600 dark:text-gray-300" aria-hidden="true" />}
          title="Connect wallet to view balances"
          description="Your balances will appear once your wallet is connected"
        />
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

  // Only block on the first load; a poll refreshing in the background must
  // not tear down balances that are already on screen.
  if (loading && balances.length === 0) {
    return (
      <div className={className}>
        <SkeletonList rows={3} label="Loading balances" />
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
      <div className={`w-full p-10 text-center ${className}`.trim()} role="alert">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/20 mb-4">
          <AlertCircle className="w-6 h-6 text-red-700 dark:text-red-300" aria-hidden="true" />
        </div>
        <p className="text-gray-600 dark:text-gray-400 text-sm font-medium">Failed to load balances</p>
        <p className="text-gray-600 dark:text-gray-300 text-xs mt-1 max-w-xs mx-auto">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <button
          onClick={() => refresh()}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
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

  // An account with no balances is an unfunded one: Horizon 404s and the
  // hook maps that to an empty array rather than an error.
  if (balances.length === 0) {
    return (
      <div className={className}>
        <EmptyState
          icon={<Coins className="w-6 h-6 text-gray-600 dark:text-gray-300" aria-hidden="true" />}
          title="No balances yet"
          description={
            connected
              ? 'This account has no balances. It may still need funding.'
              : 'This account has no balances.'
          }
        />
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

  const native = balances.find((b) => b.asset_type === 'native');
  const assets = balances.filter((b) => b.asset_type !== 'native');

  return (
    <div
      className={`w-full rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900 ${className}`.trim()}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Balances</h3>
        <button
          onClick={() => refresh()}
          disabled={loading}
          aria-label="Refresh balances"
          className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`.trim()}
            aria-hidden="true"
          />
          Refresh
        </button>
      </div>

      {native && (
        <div className="mt-4">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Native</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">
            {formatBalance(native.balance)}{' '}
            <span className="text-base font-medium text-gray-600 dark:text-gray-400">XLM</span>
          </p>
        </div>
      )}

      {assets.length > 0 && (
        <ul role="list" className="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
          {assets.map((balance) => (
            <li
              key={`${balance.asset_code}-${balance.asset_issuer}`}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                  {assetCode(balance)}
                </p>
                {balance.asset_issuer && (
                  <p className="truncate text-xs text-gray-600 dark:text-gray-400">
                    {`${balance.asset_issuer.slice(0, 4)}...${balance.asset_issuer.slice(-4)}`}
                  </p>
                )}
              </div>
              <p className="shrink-0 text-sm font-medium tabular-nums text-gray-900 dark:text-white">
                {formatBalance(balance.balance)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* A background refresh failed but stale balances are still on screen. */}
      {error && (
        <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">
          {error.message || 'Failed to refresh balances.'}
        </p>
      )}
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
