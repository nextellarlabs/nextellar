'use client';

import { useMemo } from 'react';
import { assertSafeInteractiveUrl } from '../lib/sep24';

export interface Sep24InteractiveFrameProps {
  /** Interactive URL from `useSep24Interactive().url` (already has callback=postMessage). */
  url: string;
  /** Accessible title for the iframe. */
  title?: string;
  /** Renders a close button when provided. */
  onClose?: () => void;
  /** Label for the close button. */
  closeLabel?: string;
  /** Iframe height in px. Defaults to 640. */
  height?: number;
  className?: string;
}

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

  if (!safeUrl) return null;

  return (
    <div className={`relative w-full ${className}`}>
      {onClose && (
        <button
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
}
