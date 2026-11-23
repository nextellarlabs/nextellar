'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseClipboardOptions {
  /** How long `copied` stays true after a successful copy, in ms. Default 2000. */
  resetDelayMs?: number;
}

export interface UseClipboardResult {
  /** True for `resetDelayMs` after the most recent successful copy. */
  copied: boolean;
  /** Set when the most recent copy attempt failed (e.g. insecure context, permission denied). Cleared on the next attempt. */
  error: Error | null;
  /** Copy `text` to the clipboard. Returns whether it succeeded. */
  copy: (text: string) => Promise<boolean>;
}

/**
 * Shared clipboard-copy hook with timed "copied" feedback state, for
 * building copy-to-clipboard affordances (address displays, tx hashes,
 * etc.) with consistent behavior across components.
 *
 * Extracted from the pattern originally inlined in ReceiveForm.tsx.
 */
export function useClipboard(options: UseClipboardOptions = {}): UseClipboardResult {
  const { resetDelayMs = 2000 } = options;
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    if (!text) return false;

    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setError(new Error('Clipboard API is not available in this environment.'));
      setCopied(false);
      return false;
    }

    try {
      await navigator.clipboard.writeText(text);
      setError(null);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), resetDelayMs);
      return true;
    } catch (err) {
      setCopied(false);
      setError(err instanceof Error ? err : new Error('Failed to copy to clipboard.'));
      return false;
    }
  }, [resetDelayMs]);

  return { copied, error, copy };
}
