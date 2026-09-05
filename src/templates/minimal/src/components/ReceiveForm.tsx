'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '../contexts';

// Inline SVG icons — no external icon dependency needed
const CopyIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

export interface ReceiveFormProps {
  /** Override the public key shown (e.g. to display a specific account). Defaults to the connected wallet. */
  address?: string;
  /** QR code size in pixels (width = height). Defaults to 200. */
  qrSize?: number;
  /** Optional CSS class applied to the outer container. */
  className?: string;
}

/**
 * ReceiveForm — shows a scannable QR code of the Stellar public key plus the
 * raw address string with a one-click copy button.
 *
 * SSR-safe: the QR image is generated inside a `useEffect` (client-only) via a
 * dynamic `import('qrcode')` so the component hydrates without errors even when
 * rendered on the server.
 *
 * @example
 * ```tsx
 * // Minimal usage — reads address from the connected wallet
 * <ReceiveForm />
 *
 * // Show a specific address regardless of wallet state
 * <ReceiveForm address="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" />
 * ```
 */
export default function ReceiveForm({ address: addressProp, qrSize = 200, className = '' }: ReceiveFormProps) {
  const { connected, publicKey } = useWallet();

  // Resolve the address to display: prop takes precedence, then connected wallet
  const address = addressProp ?? publicKey;

  // QR code data URL — populated client-side only to remain SSR-safe
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  // Copy-to-clipboard feedback
  const [copied, setCopied] = useState(false);

  // Generate QR code whenever the address changes (client-side only)
  useEffect(() => {
    if (!address) {
      setQrDataUrl(null);
      setQrError(null);
      return;
    }

    let cancelled = false;

    // Dynamic import keeps this module out of the server bundle entirely
    import('qrcode').then((QRCode) => {
      return QRCode.toDataURL(address, {
        width: qrSize,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
    }).then((dataUrl) => {
      if (!cancelled) {
        setQrDataUrl(dataUrl);
        setQrError(null);
      }
    }).catch((err) => {
      if (!cancelled) {
        console.error('[ReceiveForm] QR generation failed:', err);
        setQrError('Could not generate QR code.');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [address, qrSize]);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (non-secure context, etc.)
    }
  };

  // --- Disconnected / no address fallback ---
  if (!address) {
    return (
      <div
        className={`flex flex-col items-center gap-4 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 p-8 text-center ${className}`}
        data-testid="receive-form-empty"
      >
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {connected
            ? 'No address available.'
            : 'Connect your wallet to see your receive address.'}
        </p>
      </div>
    );
  }

  // --- Connected / address provided ---
  return (
    <div
      className={`flex flex-col items-center gap-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-sm ${className}`}
      data-testid="receive-form"
    >
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
        Receive Stellar Assets
      </h2>

      {/* QR Code area */}
      <div
        className="flex items-center justify-center rounded-xl bg-white p-3 shadow-inner"
        style={{ width: qrSize + 24, height: qrSize + 24 }}
        aria-label="QR code of Stellar address"
        data-testid="receive-form-qr"
      >
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUrl}
            alt={`QR code for Stellar address ${address}`}
            width={qrSize}
            height={qrSize}
            style={{ imageRendering: 'pixelated' }}
          />
        ) : qrError ? (
          <p className="text-xs text-red-500 text-center">{qrError}</p>
        ) : (
          /* Skeleton placeholder while generating */
          <div
            className="animate-pulse rounded bg-gray-200 dark:bg-gray-700"
            style={{ width: qrSize, height: qrSize }}
            aria-label="Loading QR code"
          />
        )}
      </div>

      {/* Address text + copy button */}
      <div className="flex w-full items-center gap-2 rounded-xl bg-gray-50 dark:bg-gray-800 px-4 py-2">
        <p
          className="flex-1 truncate font-mono text-xs text-gray-700 dark:text-gray-300"
          title={address}
          data-testid="receive-form-address"
        >
          {address}
        </p>

        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Address copied' : 'Copy address to clipboard'}
          className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-gray-100 transition-colors"
          data-testid="receive-form-copy"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        Only send Stellar (XLM) and supported assets to this address.
      </p>
    </div>
  );
}
