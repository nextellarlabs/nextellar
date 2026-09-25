'use client';

import { Check, Copy } from 'lucide-react';
import { useClipboard } from '../hooks/useClipboard';

/**
 * Small icon button that copies a value and announces the result.
 *
 * @param {{ value: string, label?: string, className?: string, size?: number,
 *   showConfirmationText?: boolean, confirmationClassName?: string }} props
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
                <p role="status" aria-live="polite" aria-atomic="true" className={`${confirmationClassName} min-h-[1rem]`}>
                    {copied ? confirmationMessage : ''}
                </p>
            ) : (
                <span role="status" aria-live="polite" className="sr-only">
                    {copied ? confirmationMessage : ''}
                </span>
            )}
        </>
    );
}