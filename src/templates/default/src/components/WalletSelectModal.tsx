'use client';

import { useCallback, useEffect, useId, useRef, type KeyboardEvent } from 'react';
import type { WalletOption } from '../contexts';

export interface WalletSelectModalLabels {
  title: string;
  description: string;
  loading: string;
  empty: string;
  notInstalled: string;
  install: (name: string) => string;
  close: string;
}

export const DEFAULT_WALLET_SELECT_LABELS: WalletSelectModalLabels = {
  title: 'Connect a wallet',
  description: 'Choose a Stellar wallet. Use the arrow keys to move and Enter to select.',
  loading: 'Loading wallets...',
  empty: 'No wallets are configured for this app.',
  notInstalled: 'Not installed',
  install: (name) => `Install ${name}`,
  close: 'Close',
};

export interface WalletSelectModalProps {
  open: boolean;
  /** Wallets to list; `null` while they are still loading. */
  wallets: WalletOption[] | null;
  /** Shown instead of the list when loading the wallets failed. */
  error?: string | null;
  onSelect: (walletId: string) => void;
  onClose: () => void;
  theme?: 'light' | 'dark';
  labels?: Partial<WalletSelectModalLabels>;
}

/**
 * Wallet selection modal (#911).
 *
 * Lists every configured wallet with its icon and name. Installed wallets are
 * buttons that connect it; wallets that aren't installed link to their
 * install page instead. Fully keyboard operable:
 * - focus moves into the dialog on open and back to the trigger on close
 * - ArrowUp/ArrowDown (and Home/End) move between wallets
 * - Enter/Space selects, Escape closes, Tab stays inside the dialog
 */
export default function WalletSelectModal({
  open,
  wallets,
  error,
  onSelect,
  onClose,
  theme = 'light',
  labels: labelOverrides,
}: WalletSelectModalProps) {
  const labels = { ...DEFAULT_WALLET_SELECT_LABELS, ...labelOverrides };
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const focusables = useCallback((): HTMLElement[] => {
    if (!dialogRef.current) return [];
    return Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('[data-wallet-option]'),
    );
  }, []);

  // Move focus in on open (first installed wallet, else first item, else the
  // close button) and restore it to the trigger on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const items = focusables();
    const firstInstalled = items.find((el) => el.tagName === 'BUTTON');
    const target =
      firstInstalled ??
      items[0] ??
      dialogRef.current?.querySelector<HTMLElement>('[data-close]');
    target?.focus();
  }, [open, wallets, focusables]);

  if (!open) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    const items = focusables();
    const index = items.indexOf(document.activeElement as HTMLElement);

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (items.length === 0) return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = index === -1 ? 0 : (index + delta + items.length) % items.length;
      items[next].focus();
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (items.length === 0) return;
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1].focus();
      return;
    }

    // Keep Tab inside the dialog.
    if (event.key === 'Tab' && dialogRef.current) {
      const tabbable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'),
      );
      if (tabbable.length === 0) return;
      const first = tabbable[0];
      const last = tabbable[tabbable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const surface =
    theme === 'light'
      ? 'bg-white text-gray-900 border-gray-200'
      : 'bg-gray-900 text-white border-gray-700';
  const row =
    theme === 'light'
      ? 'hover:bg-gray-100 focus-visible:ring-gray-900'
      : 'hover:bg-white/10 focus-visible:ring-white';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
        className={`w-full max-w-sm rounded-2xl border p-5 shadow-xl ${surface}`}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold">
            {labels.title}
          </h2>
          <button
            type="button"
            data-close
            onClick={onClose}
            aria-label={labels.close}
            className={`rounded-full p-1 focus-visible:outline-none focus-visible:ring-2 ${row}`}
          >
            <span aria-hidden="true">{'×'}</span>
          </button>
        </div>
        <p id={descriptionId} className="mb-4 text-sm opacity-75">
          {labels.description}
        </p>

        {error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : wallets === null ? (
          <p role="status" className="text-sm">
            {labels.loading}
          </p>
        ) : wallets.length === 0 ? (
          <p className="text-sm">{labels.empty}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {wallets.map((wallet) => (
              <li key={wallet.id}>
                {wallet.isAvailable ? (
                  <button
                    type="button"
                    data-wallet-option
                    data-wallet-id={wallet.id}
                    onClick={() => onSelect(wallet.id)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 ${row}`}
                  >
                    <img src={wallet.icon} alt="" width={28} height={28} className="h-7 w-7 rounded-md" />
                    <span className="font-medium">{wallet.name}</span>
                  </button>
                ) : (
                  <a
                    data-wallet-option
                    data-wallet-id={wallet.id}
                    href={wallet.url ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={labels.install(wallet.name)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 opacity-60 focus-visible:outline-none focus-visible:ring-2 ${row}`}
                  >
                    <img src={wallet.icon} alt="" width={28} height={28} className="h-7 w-7 rounded-md grayscale" />
                    <span className="font-medium">{wallet.name}</span>
                    <span className="ml-auto text-xs">{labels.notInstalled}</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
