'use client';

import { useEffect, useId, useState } from 'react';
import { useWallet } from '../contexts';
import { useTranslation } from '../contexts/I18nProvider';
import { canClaimBalance, useClaimableBalances } from '../hooks/useClaimableBalances';

export interface ClaimableBalanceListProps {
  /** Defaults to the connected wallet's public key. Other accounts are read only. */
  publicKey?: string;
  horizonUrl?: string;
  className?: string;
}

/** Lists pending Horizon balances for an account and lets its connected wallet claim eligible ones. */
export default function ClaimableBalanceList({
  publicKey,
  horizonUrl,
  className = '',
}: ClaimableBalanceListProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const wallet = useWallet();
  const address = publicKey ?? (wallet.connected ? wallet.publicKey : undefined);
  const { balances, loading, error, refresh, claim, claimingId, claimError, claimedId } =
    useClaimableBalances(address, horizonUrl);
  const [now, setNow] = useState(() => Date.now());

  // Predicate deadlines can pass while the list remains open.
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const canSign = wallet.connected && wallet.publicKey === address && !wallet.networkMismatch;

  return (
    <section className={`w-full rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900 ${className}`.trim()} aria-labelledby={headingId}>
      <div className="flex items-center justify-between gap-4">
        <h2 id={headingId} className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('claimable.title')}
        </h2>
        {address && (
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label={t('claimable.refresh')}
            className="rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5"
          >
            {t('claimable.refresh')}
          </button>
        )}
      </div>

      {!address && <p className="mt-4 text-sm text-gray-600 dark:text-gray-300" role="status">{t('claimable.connect')}</p>}
      {address && loading && balances.length === 0 && (
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-300" role="status">{t('claimable.loading')}</p>
      )}
      {address && error && (
        <div className="mt-4 text-sm text-red-700 dark:text-red-300" role="alert">
          <p>{t('claimable.loadError')}</p>
          <p>{error.message}</p>
          <button type="button" onClick={() => void refresh()} className="mt-2 underline">{t('claimable.retry')}</button>
        </div>
      )}
      {claimError && (
        <p className="mt-4 text-sm text-red-700 dark:text-red-300" role="alert">
          {t('claimable.claimError', { message: claimError.message })}
        </p>
      )}
      {claimedId && <p className="mt-4 text-sm text-green-700 dark:text-green-300" role="status">{t('claimable.claimed')}</p>}
      {address && !loading && !error && balances.length === 0 && (
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-300" role="status">{t('claimable.empty')}</p>
      )}

      {address && balances.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
          {balances.map((balance) => {
            const [code, issuer] = balance.asset === 'native' ? ['XLM', undefined] : balance.asset.split(':');
            const eligible = canClaimBalance(balance, address, now);
            const disabled = !eligible || !canSign || claimingId !== null;
            const label = t('claimable.claimAsset', { amount: balance.amount, asset: code });
            return (
              <li key={balance.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium tabular-nums text-gray-900 dark:text-white">{balance.amount} {code}</p>
                  {issuer && <p className="truncate text-xs text-gray-600 dark:text-gray-300" title={issuer}>{t('claimable.issuer', { issuer })}</p>}
                  {!eligible && <p className="text-xs text-gray-600 dark:text-gray-300">{t('claimable.unavailable')}</p>}
                  {eligible && !canSign && <p className="text-xs text-gray-600 dark:text-gray-300">{t('claimable.walletUnavailable')}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => void claim(balance.id).catch(() => undefined)}
                  disabled={disabled}
                  aria-label={label}
                  className="shrink-0 rounded-full bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                >
                  {claimingId === balance.id ? t('claimable.claiming') : t('claimable.claim')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
