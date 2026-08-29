'use client';

import { useState } from 'react';
import { useWallet } from '../contexts';

const CopyIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
    />
  </svg>
);

const CheckIcon = () => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

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
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!publicKey) return;
    try {
      await navigator.clipboard.writeText(publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (insecure context, permission
      // denied) — fail silently rather than surface a confusing error for
      // what is a convenience affordance, not a required action.
    }
  };

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
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Address copied' : 'Copy address'}
          className="shrink-0 rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      {copied && (
        <p role="status" className="text-xs text-green-600 dark:text-green-400">
          Copied to clipboard.
        </p>
      )}
    </div>
  );
}
