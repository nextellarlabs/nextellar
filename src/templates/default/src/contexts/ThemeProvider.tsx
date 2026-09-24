'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { storage } from '../lib/storage';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'nextellar_theme';

interface ThemeContextState {
  /** The user's chosen preference — may be "system". */
  theme: Theme;
  /** The theme actually applied right now ("system" resolved to light/dark). */
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextState | undefined>(undefined);

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyResolvedTheme(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

interface ThemeProviderProps {
  children: ReactNode;
  /** Theme used before the persisted choice (if any) has loaded. Defaults to "system". */
  defaultTheme?: Theme;
}

/**
 * Provides light/dark/system theme state to the app, persists the user's
 * choice, and applies it as a `.dark` class on `<html>` (see the
 * `@custom-variant dark` rule in `globals.css`). When the choice is
 * "system", the resolved theme tracks live `prefers-color-scheme` changes.
 *
 * @example
 * ```tsx
 * // In your app layout
 * <ThemeProvider>
 *   <YourApp />
 * </ThemeProvider>
 * ```
 */
export function ThemeProvider({ children, defaultTheme = 'system' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  // Load the persisted choice on mount and apply it immediately.
  useEffect(() => {
    const saved = storage.get(STORAGE_KEY) as Theme | null;
    const initial = saved === 'light' || saved === 'dark' || saved === 'system' ? saved : defaultTheme;
    setThemeState(initial);

    const resolved = initial === 'system' ? getSystemTheme() : initial;
    setResolvedTheme(resolved);
    applyResolvedTheme(resolved);
    // Only ever run this on mount: `defaultTheme` is a stable initial value,
    // not something that should re-trigger this effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While the choice is "system", track live OS preference changes.
  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      const resolved = event.matches ? 'dark' : 'light';
      setResolvedTheme(resolved);
      applyResolvedTheme(resolved);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    storage.set(STORAGE_KEY, next);

    const resolved = next === 'system' ? getSystemTheme() : next;
    setResolvedTheme(resolved);
    applyResolvedTheme(resolved);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to read and change the current theme.
 *
 * Must be used within a `ThemeProvider`.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { theme, resolvedTheme, setTheme } = useTheme();
 *   return <button onClick={() => setTheme('dark')}>Dark ({resolvedTheme})</button>;
 * }
 * ```
 */
export function useTheme(): ThemeContextState {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export { ThemeContext };
