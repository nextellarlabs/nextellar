'use client';

import { Check, Copy } from 'lucide-react';
import { useClipboard } from '../hooks/useClipboard';

export interface CopyButtonProps {
  /** The full (untruncated) text to copy — e.g. a public key or tx hash, not its displayed truncated form. */
  value: string;
  /** Label used in the button's aria-label and the confirmation message, e.g. "address" or "transaction hash". Defaults to "text". */
  label?: string;
  /** Extra classes merged onto the button. */
  className?: string;
  /** Icon size in pixels. Defaults to 14. */
  size?: number;
  /**
   * Render a visible "Copied to clipboard" confirmation line in addition to
   * the always-present sr-only announcement. Off by default so compact
   * layouts (a transaction row, one per line item) aren't crowded — turn it
   * on for a standalone copy affordance like an address display. Renders as
   * its own full-width block (`w-full`) below the button, so it reads
   * correctly as a new line even when the button sits in a flex row.
   */
  showConfirmationText?: boolean;
  /** Extra classes merged onto the visible confirmation text (only used when `showConfirmationText` is true). */
  confirmationClassName?: string;
}

/**
 * Copy Button
 *
 * A small icon button that copies `value` to the clipboard, showing a brief
 * checkmark and an `aria-live` confirmation for screen readers (and,
 * optionally, sighted users too via `showConfirmationText`). Built on
 * {@link useClipboard} so multiple instances (e.g. one per transaction row)
 * each get independent copied/error state.
 *
 * @example
 * <CopyButton value={publicKey} label="address" showConfirmationText />
 * <CopyButton value={tx.transaction_hash} label="transaction hash" />
 */
export default function CopyButton({
  value,
  label = 'text',
  className = '',
  size = 14,
  showConfirmationText = false,
  confirmationClassName = 'w-full text-xs text-green-600 dark:text-green-400',
}: CopyButtonProps) {
  const { copied, copy } = useClipboard();
  const confirmationMessage = `${label.charAt(0).toUpperCase()}${label.slice(1)} copied to clipboard.`;

  return (
    <>
      <button
        type="button"
        onClick={() => copy(value)}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        className={`shrink-0 rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white ${className}`.trim()}
      >
        {copied ? <Check size={size} aria-hidden="true" /> : <Copy size={size} aria-hidden="true" />}
      </button>
      {showConfirmationText ? (
        // Visible confirmation, also announced live for screen readers.
        copied && (
          <p role="status" className={confirmationClassName}>
            {confirmationMessage}
          </p>
        )
      ) : (
        // Compact layouts (e.g. a transaction row): announce without a
        // visible toast that would crowd the row.
        <span role="status" aria-live="polite" className="sr-only">
          {copied ? confirmationMessage : ''}
        </span>
      )}
    </>
  );
}
