'use client';

import { useWallet } from '../contexts';

/**
 * Account Switcher Component
 *
 * `minimal`'s WalletProvider only ever tracks a single connected account (no
 * `accounts`/`switchAccount` like the `default` template's WalletProvider),
 * so there is nothing to switch between here — this displays the connected
 * account's address rather than a dropdown menu.
 */
export default function AccountSwitcher() {
  const { connected, publicKey, walletName } = useWallet();

  if (!connected || !publicKey) {
    return null;
  }

  const shortAddress = `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;

  return (
    <div
      className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm font-medium text-gray-900 dark:text-white"
      title={publicKey}
    >
      <span className="flex items-center gap-2">
        {walletName ? `${walletName}: ` : ''}
        {shortAddress}
      </span>
    </div>
  );
}
