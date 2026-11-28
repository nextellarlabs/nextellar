'use client';

import { useState, useId, type FormEvent } from 'react';
import { AlertCircle, Droplets, RefreshCw, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { useWallet } from '../contexts';
import { useTranslation } from '../contexts/I18nProvider';
import {
  useLiquidityPool,
  type DepositParams,
  type WithdrawParams,
  type PoolReserve,
} from '../hooks/useLiquidityPool';
import { SkeletonList } from './Skeleton';
import EmptyState from './EmptyState';

export interface LiquidityPoolCardProps {
  /** 64-character hex Stellar liquidity pool ID. */
  poolId?: string | null;
  /** Account public key to display pool share for. Defaults to connected wallet. */
  publicKey?: string;
  /** Poll interval in ms. Omit to fetch once; the hook floors this at 5s. */
  pollIntervalMs?: number | null;
  /** Overrides the Horizon endpoint; defaults to the wallet provider's. */
  horizonUrl?: string;
  /** Optional price-feed lookup for computing estimated fiat value of the user's share. */
  getFiatPrice?: (asset: { code: string; issuer?: string }) => number | null | undefined;
  /** ISO 4217 currency code used to format fiat values. Defaults to "USD". */
  fiatCurrency?: string;
  /** Handler invoked when the user submits a deposit. */
  onDeposit?: (poolId: string, params: DepositParams) => Promise<void>;
  /** Handler invoked when the user submits a withdrawal. */
  onWithdraw?: (poolId: string, params: WithdrawParams) => Promise<void>;
  /** Extra classes merged onto the component root. */
  className?: string;
}

type ActionTab = 'deposit' | 'withdraw';

function formatAmount(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  });
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.00';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function truncatePoolId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}...${id.slice(-6)}`;
}

function computeEstimatedFiatValue(
  estimatedReserves: PoolReserve[],
  getFiatPrice: LiquidityPoolCardProps['getFiatPrice'],
  currency: string,
): string | null {
  if (!getFiatPrice || estimatedReserves.length === 0) return null;
  let total = 0;
  let hasAnyPrice = false;
  for (const reserve of estimatedReserves) {
    const price = getFiatPrice({ code: reserve.code, issuer: reserve.issuer });
    const amount = Number(reserve.amount);
    if (price != null && Number.isFinite(price) && Number.isFinite(amount)) {
      total += amount * price;
      hasAnyPrice = true;
    }
  }
  if (!hasAnyPrice) return null;
  const formatted = total.toLocaleString(undefined, {
    style: 'currency',
    currency,
  });
  return `≈ ${formatted}`;
}

/**
 * Liquidity Pool Card
 *
 * Displays a Stellar liquidity pool's reserves, fee tier, total shares,
 * the connected user's pool share and estimated value, and accessible
 * deposit / withdraw controls.
 *
 * All UI copy is sourced from `I18nProvider` via `useTranslation()`.
 */
export default function LiquidityPoolCard({
  poolId,
  publicKey,
  pollIntervalMs,
  horizonUrl,
  getFiatPrice,
  fiatCurrency = 'USD',
  onDeposit,
  onWithdraw,
  className = '',
}: LiquidityPoolCardProps) {
  const { t } = useTranslation();
  const { connected, publicKey: walletPublicKey } = useWallet();
  const address = publicKey ?? (connected ? walletPublicKey : null);

  const {
    pool,
    userShares,
    sharePercentage,
    estimatedReserves,
    loading,
    error,
    submitting,
    actionError,
    refresh,
    deposit,
    withdraw,
  } = useLiquidityPool(poolId, {
    publicKey: address,
    ...(horizonUrl ? { horizonUrl } : {}),
    pollIntervalMs,
    onDeposit,
    onWithdraw,
  });

  const [activeTab, setActiveTab] = useState<ActionTab>('deposit');
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [withdrawShares, setWithdrawShares] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const baseId = useId();
  const depositTabId = `${baseId}-tab-deposit`;
  const withdrawTabId = `${baseId}-tab-withdraw`;
  const depositPanelId = `${baseId}-panel-deposit`;
  const withdrawPanelId = `${baseId}-panel-withdraw`;
  const inputAId = `${baseId}-amount-a`;
  const inputBId = `${baseId}-amount-b`;
  const withdrawInputId = `${baseId}-withdraw-shares`;

  if (!poolId) {
    return (
      <div className={className}>
        <EmptyState
          icon={<Droplets className="w-6 h-6 text-gray-600 dark:text-gray-300" aria-hidden="true" />}
          title={t('liquidityPoolCard.emptyTitle')}
          description={t('liquidityPoolCard.emptyDescription')}
        />
      </div>
    );
  }

  if (loading && !pool) {
    return (
      <div className={className}>
        <SkeletonList rows={3} label={t('liquidityPoolCard.loadingLabel')} />
      </div>
    );
  }

  if (error && !pool) {
    return (
      <div className={`w-full p-10 text-center ${className}`.trim()} role="alert">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/20 mb-4">
          <AlertCircle className="w-6 h-6 text-red-700 dark:text-red-300" aria-hidden="true" />
        </div>
        <p className="text-gray-600 dark:text-gray-400 text-sm font-medium">
          {t('liquidityPoolCard.errorTitle')}
        </p>
        <p className="text-gray-600 dark:text-gray-300 text-xs mt-1 max-w-xs mx-auto">
          {error.message || t('liquidityPoolCard.errorFallback')}
        </p>
        <button
          type="button"
          onClick={() => refresh()}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          {t('liquidityPoolCard.retry')}
        </button>
      </div>
    );
  }

  if (!pool) {
    return (
      <div className={className}>
        <EmptyState
          icon={<Droplets className="w-6 h-6 text-gray-600 dark:text-gray-300" aria-hidden="true" />}
          title={t('liquidityPoolCard.emptyTitle')}
          description={t('liquidityPoolCard.emptyDescription')}
        />
      </div>
    );
  }

  const reserveA = pool.reserves[0];
  const reserveB = pool.reserves[1];
  const pairTitle =
    pool.reserves.length >= 2
      ? `${reserveA.code} / ${reserveB.code}`
      : t('liquidityPoolCard.title');
  const feePercent = (pool.feeBp / 100).toFixed(2);
  const ownedSharesNum = Number(userShares);
  const hasShares = Number.isFinite(ownedSharesNum) && ownedSharesNum > 0;
  const estimatedFiat = computeEstimatedFiatValue(estimatedReserves, getFiatPrice, fiatCurrency);

  const handleTabChange = (tab: ActionTab) => {
    setActiveTab(tab);
    setValidationError(null);
    setSuccessMessage(null);
  };

  const handleDepositSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setSuccessMessage(null);

    const a = Number(amountA);
    const b = Number(amountB);
    if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b) || b <= 0) {
      setValidationError(t('liquidityPoolCard.validationPositiveAmount'));
      return;
    }

    try {
      await deposit({ maxAmountA: amountA.trim(), maxAmountB: amountB.trim() });
      setAmountA('');
      setAmountB('');
      setSuccessMessage(t('liquidityPoolCard.depositSuccess'));
    } catch {
      // actionError is surfaced by the hook
    }
  };

  const handleWithdrawSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    setSuccessMessage(null);

    const amt = Number(withdrawShares);
    if (!Number.isFinite(amt) || amt <= 0) {
      setValidationError(t('liquidityPoolCard.validationPositiveAmount'));
      return;
    }
    if (Number.isFinite(ownedSharesNum) && amt > ownedSharesNum) {
      setValidationError(t('liquidityPoolCard.validationExceedsShares'));
      return;
    }

    try {
      await withdraw({ amount: withdrawShares.trim() });
      setWithdrawShares('');
      setSuccessMessage(t('liquidityPoolCard.withdrawSuccess'));
    } catch {
      // actionError is surfaced by the hook
    }
  };

  return (
    <section
      aria-label={t('liquidityPoolCard.regionLabel')}
      className={`w-full rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900 ${className}`.trim()}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white truncate">
              {pairTitle}
            </h3>
            <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              {t('liquidityPoolCard.feeBadge', { fee: feePercent })}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 font-mono">
            {t('liquidityPoolCard.poolIdLabel', { id: truncatePoolId(pool.id) })}
          </p>
        </div>

        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading}
          aria-label={t('liquidityPoolCard.refreshAriaLabel')}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`.trim()}
            aria-hidden="true"
          />
          {t('liquidityPoolCard.refresh')}
        </button>
      </div>

      {/* Pool Reserves */}
      <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
        <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {t('liquidityPoolCard.reservesHeading')}
        </h4>
        <ul role="list" className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
          {pool.reserves.map((reserve) => (
            <li
              key={reserve.asset}
              className="flex items-center justify-between gap-4 py-2 text-sm"
            >
              <span className="font-medium text-gray-900 dark:text-white">{reserve.code}</span>
              <span className="tabular-nums text-gray-700 dark:text-gray-300">
                {formatAmount(reserve.amount)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="mt-2 grid grid-cols-2 gap-3 rounded-md bg-gray-50 p-2.5 text-xs dark:bg-gray-800/60">
          <div>
            <dt className="text-gray-500 dark:text-gray-400">
              {t('liquidityPoolCard.totalSharesLabel')}
            </dt>
            <dd className="mt-0.5 font-medium tabular-nums text-gray-900 dark:text-white">
              {formatAmount(pool.totalShares)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">
              {t('liquidityPoolCard.trustlinesLabel')}
            </dt>
            <dd className="mt-0.5 font-medium tabular-nums text-gray-900 dark:text-white">
              {pool.totalTrustlines}
            </dd>
          </div>
        </dl>
      </div>

      {/* User's Pool Share & Estimated Value */}
      <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
        <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {t('liquidityPoolCard.yourPositionHeading')}
        </h4>

        {!address ? (
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            {t('liquidityPoolCard.connectPrompt')}
          </p>
        ) : !hasShares ? (
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            {t('liquidityPoolCard.noPosition')}
          </p>
        ) : (
          <dl className="mt-2 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-gray-600 dark:text-gray-400">
                {t('liquidityPoolCard.poolShareLabel')}
              </dt>
              <dd className="font-medium tabular-nums text-gray-900 dark:text-white">
                {t('liquidityPoolCard.sharesCount', {
                  shares: formatAmount(userShares),
                  percent: formatPercent(sharePercentage),
                })}
              </dd>
            </div>

            {estimatedFiat && (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-gray-600 dark:text-gray-400">
                  {t('liquidityPoolCard.estimatedValueLabel')}
                </dt>
                <dd className="font-semibold tabular-nums text-gray-900 dark:text-white">
                  {estimatedFiat}
                </dd>
              </div>
            )}

            {estimatedReserves.length > 0 && (
              <div>
                <dt className="text-xs text-gray-500 dark:text-gray-400">
                  {t('liquidityPoolCard.estimatedReservesLabel')}
                </dt>
                <dd className="mt-1 flex flex-wrap gap-2">
                  {estimatedReserves.map((res) => (
                    <span
                      key={res.asset}
                      className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium tabular-nums text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                    >
                      {`${formatAmount(res.amount)} ${res.code}`}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {/* Deposit / Withdraw Actions */}
      {address && (
        <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
          <div
            role="tablist"
            aria-label={t('liquidityPoolCard.actionsTabListLabel')}
            className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800"
          >
            <button
              id={depositTabId}
              type="button"
              role="tab"
              aria-selected={activeTab === 'deposit'}
              aria-controls={depositPanelId}
              onClick={() => handleTabChange('deposit')}
              className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'deposit'
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              <ArrowDownToLine className="w-3.5 h-3.5" aria-hidden="true" />
              {t('liquidityPoolCard.depositTab')}
            </button>
            <button
              id={withdrawTabId}
              type="button"
              role="tab"
              aria-selected={activeTab === 'withdraw'}
              aria-controls={withdrawPanelId}
              onClick={() => handleTabChange('withdraw')}
              className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'withdraw'
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              <ArrowUpFromLine className="w-3.5 h-3.5" aria-hidden="true" />
              {t('liquidityPoolCard.withdrawTab')}
            </button>
          </div>

          {activeTab === 'deposit' ? (
            <form
              id={depositPanelId}
              role="tabpanel"
              aria-labelledby={depositTabId}
              onSubmit={handleDepositSubmit}
              className="mt-3 space-y-3"
              noValidate
            >
              {reserveA && (
                <div>
                  <label
                    htmlFor={inputAId}
                    className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t('liquidityPoolCard.amountLabel', { asset: reserveA.code })}
                  </label>
                  <input
                    id={inputAId}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={amountA}
                    onChange={(e) => setAmountA(e.target.value)}
                    placeholder={t('liquidityPoolCard.amountPlaceholder')}
                    disabled={submitting}
                    className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm tabular-nums text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  />
                </div>
              )}

              {reserveB && (
                <div>
                  <label
                    htmlFor={inputBId}
                    className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t('liquidityPoolCard.amountLabel', { asset: reserveB.code })}
                  </label>
                  <input
                    id={inputBId}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={amountB}
                    onChange={(e) => setAmountB(e.target.value)}
                    placeholder={t('liquidityPoolCard.amountPlaceholder')}
                    disabled={submitting}
                    className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm tabular-nums text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {submitting
                  ? t('liquidityPoolCard.submitting')
                  : t('liquidityPoolCard.depositSubmit')}
              </button>
            </form>
          ) : (
            <form
              id={withdrawPanelId}
              role="tabpanel"
              aria-labelledby={withdrawTabId}
              onSubmit={handleWithdrawSubmit}
              className="mt-3 space-y-3"
              noValidate
            >
              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor={withdrawInputId}
                    className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t('liquidityPoolCard.sharesInputLabel')}
                  </label>
                  {hasShares && (
                    <button
                      type="button"
                      onClick={() => setWithdrawShares(userShares)}
                      disabled={submitting}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {t('liquidityPoolCard.maxButton')}
                    </button>
                  )}
                </div>
                <input
                  id={withdrawInputId}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={withdrawShares}
                  onChange={(e) => setWithdrawShares(e.target.value)}
                  placeholder={t('liquidityPoolCard.amountPlaceholder')}
                  disabled={submitting}
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm tabular-nums text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || !hasShares}
                className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {submitting
                  ? t('liquidityPoolCard.submitting')
                  : t('liquidityPoolCard.withdrawSubmit')}
              </button>
            </form>
          )}

          {(validationError || actionError) && (
            <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
              {validationError ?? actionError?.message}
            </p>
          )}

          {successMessage && (
            <p role="status" className="mt-2 text-xs text-green-700 dark:text-green-400">
              {successMessage}
            </p>
          )}
        </div>
      )}

      {/* Background refresh error while stale pool data is still visible */}
      {error && (
        <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400">
          {error.message || t('liquidityPoolCard.refreshError')}
        </p>
      )}
    </section>
  );
}
