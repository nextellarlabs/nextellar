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
  /**
   * Optional price-feed lookup, called per balance with its asset code
   * ("XLM" for native) and issuer (undefined for native). Returns the
   * asset's price in fiat units, or `null`/`undefined` if no price is
   * available for that asset — the fiat line is simply omitted in that case
   * rather than showing a misleading "$0.00". Not called at all when the
   * prop is omitted, so this stays fully optional and has no cost for
   * consumers who don't need it.
   */
  getFiatPrice?: (asset: { code: string; issuer?: string }) => number | null | undefined;
  /** ISO 4217 currency code used to format the fiat-equivalent line. Defaults to "USD". */
  fiatCurrency?: string;
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
}

/** Renders a balance's fiat equivalent (e.g. "≈ $12.34"), or null if no price is available. */
function formatFiatEquivalent(
  balanceRaw: string,
  price: number | null | undefined,
  currency: string,
): string | null {
  if (price == null || !Number.isFinite(price)) return null;
  const amount = Number(balanceRaw);
  if (!Number.isFinite(amount)) return null;

  const formatted = (amount * price).toLocaleString(undefined, {
    style: 'currency',
    currency,
  });
  return `≈ ${formatted}`;
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
 *
 * // With a fiat-equivalent line under each balance.
 * <BalanceDisplay getFiatPrice={({ code }) => prices[code]} fiatCurrency="EUR" />
 * ```
 */
export default function BalanceDisplay({
  publicKey,
  pollIntervalMs,
  horizonUrl,
  className = '',
  getFiatPrice,
  fiatCurrency = 'USD',
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
      </div>
    );
  }

  // Only block on the first load; a poll refreshing in the background must
  // not tear down balances that are already on screen.
  if (loading && balances.length === 0) {
    return (
      <div className={className}>
        <SkeletonList rows={3} label="Loading balances" />
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
          {(() => {
            const fiat = formatFiatEquivalent(
              native.balance,
              getFiatPrice?.({ code: 'XLM' }),
              fiatCurrency,
            );
            return fiat ? (
              <p className="mt-0.5 text-xs tabular-nums text-gray-500 dark:text-gray-400">{fiat}</p>
            ) : null;
          })()}
        </div>
      )}

      {assets.length > 0 && (
        <ul role="list" className="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
          {assets.map((balance) => {
            const fiat = formatFiatEquivalent(
              balance.balance,
              getFiatPrice?.({ code: assetCode(balance), issuer: balance.asset_issuer }),
              fiatCurrency,
            );
            return (
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
                <div className="shrink-0 text-right">
                  <p className="text-sm font-medium tabular-nums text-gray-900 dark:text-white">
                    {formatBalance(balance.balance)}
                  </p>
                  {fiat && (
                    <p className="text-xs tabular-nums text-gray-500 dark:text-gray-400">{fiat}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* A background refresh failed but stale balances are still on screen. */}
      {error && (
        <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">
          {error.message || 'Failed to refresh balances.'}
        </p>
      )}
    </div>
  );
}
