'use client';

import { useWallet } from '../contexts';
import CopyButton from './CopyButton';

/**
 * Receive Form
 *
 * Displays the connected wallet's public key and a one-click copy button.
 * No QR rendering — kept dependency-free (the scaffolded app doesn't ship a
 * QR library by default); a QR variant can be layered on top of this once a
 * project actually needs it.
 */
export default function ReceiveForm() {
  const { connected, publicKey } = useWallet();

  if (!connected || !publicKey) {
    return (
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-4 text-center dark:border-gray-700 dark:bg-gray-900">
        <p className="text-sm text-gray-500 dark:text-gray-400">Connect a wallet to receive payments.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Receive Payment</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Share this address to receive XLM or other assets.
      </p>
      <div className="flex items-center gap-2 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 dark:border-gray-600 dark:bg-gray-800">
        <code className="flex-1 truncate text-xs text-gray-900 dark:text-white">{publicKey}</code>
        <CopyButton value={publicKey} label="address" className="p-1.5" showConfirmationText />
      </div>
    </div>
  );
}
