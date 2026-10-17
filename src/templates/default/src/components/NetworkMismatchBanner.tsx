'use client';

import { AlertCircle } from 'lucide-react';
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
 */
export function NetworkMismatchBanner() {
  const { networkMismatch, walletNetworkPassphrase } = useWallet();
  const config = useWalletConfig();

  if (!networkMismatch) return null;

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
        <div>
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
      </div>
    </div>
  );
}
