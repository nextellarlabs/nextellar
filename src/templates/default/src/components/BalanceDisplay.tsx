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
      </div>
    );
  }

  if (loading && balances.length === 0) {
    return <SkeletonList rows={3} label="Loading account balances" />;
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
  );
}
