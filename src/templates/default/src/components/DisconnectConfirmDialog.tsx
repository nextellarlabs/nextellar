'use client';

import { useEffect, useId, useRef, type KeyboardEvent } from 'react';

export interface DisconnectConfirmLabels {
  title: (walletName: string) => string;
  body: string;
  confirm: string;
  cancel: string;
}

export const DEFAULT_DISCONNECT_CONFIRM_LABELS: DisconnectConfirmLabels = {
  title: (walletName) => `Disconnect ${walletName}?`,
  body:
    'This ends the session on this device. It will not reconnect automatically when you reload; connect again to sign transactions.',
  confirm: 'Disconnect',
  cancel: 'Cancel',
};

export interface DisconnectConfirmDialogProps {
  open: boolean;
  walletName?: string;
  onConfirm: () => void;
  onCancel: () => void;
  theme?: 'light' | 'dark';
  labels?: Partial<DisconnectConfirmLabels>;
}

/**
 * Confirmation step before disconnecting a wallet (#910).
 *
 * An `alertdialog`: Cancel is focused first so pressing Enter by accident
 * keeps the session, Escape cancels, and Tab stays inside the dialog.
 */
export default function DisconnectConfirmDialog({
  open,
  walletName,
  onConfirm,
  onCancel,
  theme = 'light',
  labels: labelOverrides,
}: DisconnectConfirmDialogProps) {
  const labels = { ...DEFAULT_DISCONNECT_CONFIRM_LABELS, ...labelOverrides };
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const next =
        document.activeElement === cancelRef.current ? confirmRef.current : cancelRef.current;
      next?.focus();
    }
  };

  const surface =
    theme === 'light'
      ? 'bg-white text-gray-900 border-gray-200'
      : 'bg-gray-900 text-white border-gray-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={handleKeyDown}
        className={`w-full max-w-sm rounded-2xl border p-5 shadow-xl ${surface}`}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {labels.title(walletName ?? 'wallet')}
        </h2>
        <p id={bodyId} className="mt-2 text-sm opacity-75">
          {labels.body}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-full border border-current px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            {labels.cancel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
          >
            {labels.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
