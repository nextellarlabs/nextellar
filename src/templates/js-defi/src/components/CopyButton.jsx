'use client';

import { Check, Copy } from 'lucide-react';
import { useClipboard } from '../hooks/useClipboard';

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
 * ```jsx
 * <CopyButton value={publicKey} label="address" showConfirmationText />
 * <CopyButton value={tx.transaction_hash} label="transaction hash" />
 * ```
 *
 * @param {{
 *   value: string,
 *   label?: string,
 *   className?: string,
 *   size?: number,
 *   showConfirmationText?: boolean,
 *   confirmationClassName?: string,
 * }} props
 */
export default function CopyButton({
  value,
  label = 'text',
  className = '',
  size = 14,
  showConfirmationText = false,
  confirmationClassName = 'w-full text-xs text-green-600 dark:text-green-400',
}) {
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
        copied && (
          <p role="status" className={confirmationClassName}>
            {confirmationMessage}
          </p>
        )
      ) : (
        <span role="status" aria-live="polite" className="sr-only">
          {copied ? confirmationMessage : ''}
        </span>
      )}
    </>
  );
}
