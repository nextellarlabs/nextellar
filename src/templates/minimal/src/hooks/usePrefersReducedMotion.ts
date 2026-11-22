'use client';

import { useCallback, useEffect, useState } from 'react';

/** Media query for the OS-level "reduce motion" accessibility setting. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Reads `prefers-reduced-motion: reduce` once, safely. Returns `false` on the
 * server and wherever `matchMedia` is unavailable (older browsers, jsdom).
 */
export function readPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches === true;
  } catch {
    return false;
  }
}

/**
 * Whether the user asked the OS to reduce motion.
 *
 * Reads the media query after mount (so server and first client render
 * agree) and exposes `refresh()` so callers can re-check right before an
 * animated change, picking up a setting changed while the page was open.
 * It deliberately does not subscribe to `change` events: components that
 * only animate on user action don't need a long-lived listener.
 *
 * @example
 * ```tsx
 * const { prefersReducedMotion } = usePrefersReducedMotion();
 * <div className={prefersReducedMotion ? '' : 'transition-colors'} />
 * ```
 */
export function usePrefersReducedMotion(): { prefersReducedMotion: boolean; refresh: () => boolean } {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    setPrefersReducedMotion(readPrefersReducedMotion());
  }, []);

  const refresh = useCallback(() => {
    const next = readPrefersReducedMotion();
    setPrefersReducedMotion(next);
    return next;
  }, []);

  return { prefersReducedMotion, refresh };
}
