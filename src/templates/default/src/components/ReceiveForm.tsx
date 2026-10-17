'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useWallet } from '../contexts';
import { buildSep7PayUri } from '../lib/sep7';
import { encodeQr, qrToSvgPath, qrToSvgString } from '../lib/qr';

/** Quiet-zone width around the QR code, in modules. */
const QR_BORDER = 2;

function truncateAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 6)}…${address.slice(-6)}` : address;
}

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

const DownloadIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
  </svg>
);

export interface ReceiveFormProps {
  /** Override the public key shown (e.g. to display a specific account). Defaults to the connected wallet. */
  address?: string;
  /** QR code size in pixels (width = height). Defaults to 200. */
  qrSize?: number;
  /** Optional CSS class applied to the outer container. */
  className?: string;
  /**
   * Requested payment amount. When set (together with `asset` for a
   * non-native asset), the QR code and copy button encode a SEP-7
   * `web+stellar:pay` payment-request URI instead of a bare address —
   * see https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md.
   */
  amount?: string;
  /** Non-native asset the payment request is denominated in. Requires `amount` to have any effect. Omit for native XLM. */
  asset?: { code: string; issuer: string };
  /** Memo to include in the SEP-7 payment request. Only applies when `amount` is set. */
  memo?: string;
  /** Human-readable message shown to the payer's wallet. Only applies when `amount` is set. */
  message?: string;
}

/**
 * ReceiveForm — shows a scannable QR code of the Stellar public key plus the
 * address (monospace, truncated, with a full-key reveal) and a one-click copy
 * button with "Copied!" feedback.
 *
 * The QR code is generated in-house as an inline SVG (`lib/qr.ts`, ~3 KB
 * gzipped, no dependency), so it is SSR-safe and renders identically on the
 * server and client (issue #662).
 *
 * @example
 * ```tsx
 * // Minimal usage — reads address from the connected wallet
 * <ReceiveForm />
 *
 * // Show a specific address regardless of wallet state
 * <ReceiveForm address="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" />
 *
 * // Encode a SEP-7 payment request (amount + asset) instead of a bare address
 * <ReceiveForm amount="25" asset={{ code: 'USDC', issuer: 'GISSUER...' }} message="Invoice #42" />
 * ```
 */
export default function ReceiveForm({
  address: addressProp,
  qrSize = 200,
  className = '',
  amount,
  asset,
  memo,
  message,
}: ReceiveFormProps) {
  const { connected, publicKey } = useWallet();

  // Resolve the address to display: prop takes precedence, then connected wallet
  const address = addressProp ?? publicKey;

  // When an amount is requested, encode a SEP-7 `web+stellar:pay` URI instead
  // of a bare address — this is what the QR code and copy button target.
  // The address shown as text always stays the plain address for readability.
  const sep7Uri = useMemo(() => {
    if (!address || amount === undefined) return null;
    try {
      return buildSep7PayUri({ destination: address, amount, asset, memo, msg: message });
    } catch (err) {
      console.error('[ReceiveForm] Failed to build SEP-7 payment URI:', err);
      return null;
    }
  }, [address, amount, asset, memo, message]);

  const qrPayload = sep7Uri ?? address;

  // QR code as inline SVG — pure computation, so it is SSR-safe.
  const qr = useMemo(() => {
    if (!qrPayload) return { path: null as string | null, dim: 0, error: null as string | null };
    try {
      const matrix = encodeQr(qrPayload);
      return { path: qrToSvgPath(matrix, QR_BORDER), dim: matrix.size + QR_BORDER * 2, error: null };
    } catch (err) {
      console.error('[ReceiveForm] QR generation failed:', err);
      return { path: null, dim: 0, error: 'Could not generate QR code.' };
    }
  }, [qrPayload]);

  // Copy-to-clipboard feedback
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const handleCopy = async () => {
    if (!qrPayload) return;
    try {
      await navigator.clipboard.writeText(qrPayload);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (non-secure context, etc.)
    }
  };

  // Saves the QR as an SVG file by driving a temporary, off-DOM anchor's
  // `download` attribute — no server round-trip needed.
  const handleDownload = () => {
    if (!qrPayload || !qr.path) return;
    const link = document.createElement('a');
    link.href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrToSvgString(qrPayload, { border: QR_BORDER }))}`;
    link.download = `stellar-address-${address ? address.slice(0, 8) : 'qr'}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
        {sep7Uri ? 'Request Payment' : 'Receive Stellar Assets'}
      </h2>

      {/* QR Code area */}
      <div
        className="flex items-center justify-center rounded-xl bg-white p-3 shadow-inner"
        style={{ width: qrSize + 24, height: qrSize + 24 }}
        aria-label={sep7Uri ? 'QR code of SEP-7 payment request' : 'QR code of Stellar address'}
        data-testid="receive-form-qr"
      >
        {qr.path ? (
          <svg
            role="img"
            aria-label={
              sep7Uri
                ? `QR code for a SEP-7 payment request to ${address}`
                : `QR code for Stellar address ${address}`
            }
            width={qrSize}
            height={qrSize}
            viewBox={`0 0 ${qr.dim} ${qr.dim}`}
            shapeRendering="crispEdges"
            data-testid="receive-form-qr-svg"
          >
            <rect width="100%" height="100%" fill="#ffffff" />
            <path d={qr.path} fill="#000000" />
          </svg>
        ) : (
          <p className="text-xs text-red-500 text-center">{qr.error}</p>
        )}
      </div>

      {qr.path && (
        <button
          type="button"
          onClick={handleDownload}
          aria-label="Download QR code as SVG"
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100 transition-colors"
          data-testid="receive-form-download"
        >
          <DownloadIcon />
          Download QR
        </button>
      )}

      {sep7Uri && (
        <p className="text-xs text-gray-500 dark:text-gray-400" data-testid="receive-form-request-summary">
          Requesting {amount}
          {asset ? ` ${asset.code}` : ' XLM'}
        </p>
      )}

      {/* Address text + copy button */}
      <div className="flex w-full items-center gap-2 rounded-xl bg-gray-50 dark:bg-gray-800 px-4 py-2">
        <p
          className={`flex-1 font-mono text-xs text-gray-700 dark:text-gray-300 ${revealed ? 'break-all' : 'truncate'}`}
          title={address}
          data-testid="receive-form-address"
        >
          {revealed ? address : truncateAddress(address)}
        </p>

        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-expanded={revealed}
          aria-label={revealed ? 'Hide full address' : 'Show full address'}
          className="shrink-0 rounded-lg px-1.5 py-1 text-xs text-gray-500 hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-gray-100"
          data-testid="receive-form-reveal"
        >
          {revealed ? 'Hide' : 'Show'}
        </button>

        <button
          type="button"
          onClick={handleCopy}
          aria-label={
            copied
              ? sep7Uri
                ? 'Payment request copied'
                : 'Address copied'
              : sep7Uri
                ? 'Copy payment request to clipboard'
                : 'Copy address to clipboard'
          }
          className="shrink-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-gray-100 transition-colors"
          data-testid="receive-form-copy"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>

      <p aria-live="polite" className="min-h-[1rem] text-xs text-green-600 dark:text-green-400" data-testid="receive-form-copied">
        {copied ? 'Copied!' : ''}
      </p>

      <p className="text-xs text-gray-400 dark:text-gray-500">
        Only send Stellar (XLM) and supported assets to this address.
      </p>
    </div>
  );
}
