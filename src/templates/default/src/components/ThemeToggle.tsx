'use client';

import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type Theme } from '../contexts/ThemeProvider';

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/**
 * A three-way light/dark/system theme switcher. Reads and writes theme
 * state via `useTheme()`, so it must be rendered within a `ThemeProvider`.
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

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
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
            onClick={() => setTheme(value)}
            className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
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
