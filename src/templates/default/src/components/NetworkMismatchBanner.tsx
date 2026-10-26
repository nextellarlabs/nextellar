'use client';

import { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useWallet, useWalletConfig } from '../contexts/WalletProvider';
import { NETWORKS } from '../config/networks';

/**
 * Warns when the connected wallet's own reported network differs from this
 * app's configured Horizon/Soroban network (#1072) — e.g. a wallet extension
 * set to mainnet while the app is configured for testnet. Signing a
 * transaction in that state targets whichever network the wallet is
 * actually on, not the one the app's UI implies.
 *
 * Renders nothing when not connected, when the wallet didn't report a
 * network, or when the networks agree.
 *
 * Dismissible (#1277): dismissing is keyed to the specific
 * wallet/app network pair that was shown, not to "a mismatch exists" in
 * general, so switching to a *different* mismatched network (e.g. wallet
 * moves from mainnet to futurenet while the app stays on testnet) reappears
 * the banner even though a prior mismatch was dismissed.
 */
export function NetworkMismatchBanner() {
  const { networkMismatch, walletNetworkPassphrase } = useWallet();
  const config = useWalletConfig();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const mismatchKey = `${walletNetworkPassphrase ?? ''}|${config?.network ?? ''}`;

  if (!networkMismatch || dismissedKey === mismatchKey) return null;

  const appNetworkName = config
    ? Object.values(NETWORKS).find((n) => n.passphrase === config.network)?.name ?? config.network
    : undefined;
  const walletNetworkName =
    Object.values(NETWORKS).find((n) => n.passphrase === walletNetworkPassphrase)?.name ??
    walletNetworkPassphrase;

  return (
    <div
      role="alert"
      className="w-full rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30"
    >
      <div className="flex items-start gap-3">
        <AlertCircle
          className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Wallet network mismatch
          </p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            Your wallet is on <strong>{walletNetworkName}</strong>, but this app is
            configured for <strong>{appNetworkName}</strong>. Signing a transaction now
            will target your wallet&apos;s network, not the app&apos;s. Switch your
            wallet&apos;s network, or switch the app&apos;s network, before signing.
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissedKey(mismatchKey)}
          className="flex-shrink-0 rounded-md p-1 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
