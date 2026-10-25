'use client';

import { useEffect, useMemo, useRef } from 'react';
import { assertSafeInteractiveUrl } from '../lib/sep24';

export interface Sep24InteractiveFrameProps {
  /** Interactive URL from `useSep24Interactive().url` (already has callback=postMessage). */
  url: string;
  /** Accessible title for the iframe. */
  title?: string;
  /**
   * Renders a close button when provided, and switches the component into
   * modal mode (#1278): a focus-trapping dialog over a dimmed overlay,
   * dismissible with Escape or the close button. Without `onClose` there is
   * nothing to dismiss, so the frame stays a plain inline embed (its
   * original behavior, still used to embed the flow directly in a page).
   */
  onClose?: () => void;
  /** Label for the close button. */
  closeLabel?: string;
  /** Iframe height in px. Defaults to 640. */
  height?: number;
  className?: string;
}

/** Focusable elements a Tab-trap should cycle through inside the dialog. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

/**
 * Sep24InteractiveFrame
 *
 * Embeds an anchor's SEP-24 interactive deposit/withdraw page. Pair it with
 * `useSep24Interactive({ ... })` started in `mode: 'iframe'`: the anchor posts
 * transaction updates to this window, and the hook validates their origin.
 *
 * Only https URLs (or http://localhost) are rendered, so a malicious anchor
 * response cannot inject a `javascript:` or `data:` frame. The iframe is
 * sandboxed to what anchor forms need (scripts, forms, popups for KYC
 * providers, and their own origin for cookies).
 *
 * When `onClose` is passed, this renders as a modal dialog (`role="dialog"`,
 * `aria-modal`) over a dimmed overlay: focus is trapped inside it (Tab/
 * Shift+Tab wrap at its edges instead of escaping to the page behind it),
 * Escape calls `onClose`, and focus returns to whatever triggered the dialog
 * once it closes.
 *
 * @example
 * const sep24 = useSep24Interactive();
 * // await sep24.start({ ..., mode: 'iframe' });
 * {sep24.url && sep24.status === 'interactive' && (
 *   <Sep24InteractiveFrame url={sep24.url} onClose={sep24.cancel} />
 * )}
 */
export default function Sep24InteractiveFrame({
  url,
  title = 'Anchor deposit and withdrawal',
  onClose,
  closeLabel = 'Close',
  height = 640,
  className = '',
}: Sep24InteractiveFrameProps) {
  const safeUrl = useMemo(() => {
    try {
      return assertSafeInteractiveUrl(url).toString();
    } catch {
      return null;
    }
  }, [url]);

  const isModal = !!onClose;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isModal || !safeUrl) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }

      if (e.key !== 'Tab') return;

      const node = dialogRef.current;
      if (!node) return;
      const focusable = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => getComputedStyle(el).display !== 'none');
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModal, safeUrl]);

  if (!safeUrl) return null;

  const frame = (
    <div
      ref={isModal ? dialogRef : undefined}
      role={isModal ? 'dialog' : undefined}
      aria-modal={isModal ? true : undefined}
      aria-label={isModal ? title : undefined}
      className={`relative w-full ${className}`}
    >
      {onClose && (
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 rounded-md border px-2 py-1 text-xs"
        >
          {closeLabel}
        </button>
      )}
      <iframe
        src={safeUrl}
        title={title}
        style={{ height }}
        className="w-full rounded-lg border"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        referrerPolicy="no-referrer"
      />
    </div>
  );

  if (!isModal) return frame;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-full w-full max-w-2xl overflow-auto">{frame}</div>
    </div>
  );
}
