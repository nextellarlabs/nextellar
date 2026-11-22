'use client';

import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type Theme } from '../contexts/ThemeProvider';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/**
 * A three-way light/dark/system theme switcher. Reads and writes theme
 * state via `useTheme()`, so it must be rendered within a `ThemeProvider`.
 *
 * The color transition on the options is skipped entirely when the user has
 * `prefers-reduced-motion: reduce` set. The preference is re-checked on each
 * selection, so changing the OS setting takes effect on the next switch
 * without a reload. `motion-reduce:transition-none` is kept as a CSS-level
 * fallback for the first paint before the preference has been read.
 *
 * @example
 * ```tsx
 * <ThemeProvider>
 *   <ThemeToggle />
 * </ThemeProvider>
 * ```
 */
export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { prefersReducedMotion, refresh } = usePrefersReducedMotion();
  const transitionClass = prefersReducedMotion
    ? 'transition-none'
    : 'transition-colors motion-reduce:transition-none';

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      data-reduced-motion={prefersReducedMotion ? 'true' : 'false'}
      className="inline-flex items-center gap-1 p-1 rounded-full border border-gray-200 dark:border-white/20 bg-white/60 dark:bg-white/5"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => {
              refresh();
              setTheme(value);
            }}
            className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${transitionClass} ${
              selected
                ? 'bg-black text-white dark:bg-white dark:text-black'
                : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10'
            }`}
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
