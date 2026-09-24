'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { storage } from '../lib/storage';
import { en } from '../locales/en';

/**
 * Locale registry. Add a new locale by creating `src/locales/<code>.ts`
 * exporting the same key shape as `en` (see `src/locales/en.ts`), then
 * register it here.
 */
export const locales = { en } as const;

export type Locale = keyof typeof locales;
export type Messages = typeof en;

const STORAGE_KEY = 'nextellar_locale';
const DEFAULT_LOCALE: Locale = 'en';

/** Dot-separated paths into `Messages`, e.g. "wallet.connected". */
type MessagePath = keyof FlattenPaths<Messages>;
type FlattenPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? { [P in `${Prefix}${K}`]: T[K] }
    : FlattenPaths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

function resolvePath(messages: Messages, path: string): string {
  const value = path
    .split('.')
    .reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), messages);
  return typeof value === 'string' ? value : path;
}

/** Substitutes `{token}` placeholders in a message string, e.g. "Connected as {address}". */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, token: string) =>
    token in params ? String(params[token]) : match
  );
}

interface I18nContextState {
  locale: Locale;
  messages: Messages;
  setLocale: (locale: Locale) => void;
  availableLocales: Locale[];
  /** Looks up a message by dot-path (e.g. "wallet.connected") and interpolates any `{token}` placeholders. */
  t: (path: MessagePath, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextState | undefined>(undefined);

function isLocale(value: string | null): value is Locale {
  return value !== null && value in locales;
}

interface I18nProviderProps {
  children: ReactNode;
  /** Locale used before the persisted choice (if any) has loaded. Defaults to "en". */
  defaultLocale?: Locale;
}

/**
 * Optional i18n wiring — not enabled by default. To opt in, wrap your app
 * layout:
 *
 * @example
 * ```tsx
 * // src/app/layout.tsx
 * import { I18nProvider } from "@/contexts";
 *
 * <I18nProvider>
 *   <YourApp />
 * </I18nProvider>
 * ```
 *
 * Add more locales by creating `src/locales/<code>.ts` (copy `en.ts`'s key
 * shape) and registering it in the `locales` map above.
 */
export function I18nProvider({ children, defaultLocale = DEFAULT_LOCALE }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  useEffect(() => {
    const saved = storage.get(STORAGE_KEY);
    if (isLocale(saved)) {
      setLocaleState(saved);
    }
    // Only ever run this on mount: `defaultLocale` is a stable initial
    // value, not something that should re-trigger this effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    storage.set(STORAGE_KEY, next);
  }, []);

  const messages = locales[locale];
  const t = useCallback(
    (path: MessagePath, params?: Record<string, string | number>) =>
      interpolate(resolvePath(messages, path), params),
    [messages]
  );

  return (
    <I18nContext.Provider
      value={{
        locale,
        messages,
        setLocale,
        availableLocales: Object.keys(locales) as Locale[],
        t,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

/**
 * Hook to read the active locale's messages and switch locales.
 *
 * Must be used within an `I18nProvider`.
 *
 * @example
 * ```tsx
 * function Greeting() {
 *   const { t, locale, setLocale } = useTranslation();
 *   return <h1>{t('home.title')}</h1>;
 * }
 *
 * function WalletStatus({ address }: { address: string }) {
 *   const { t } = useTranslation();
 *   return <p>{t('wallet.connected', { address })}</p>;
 * }
 * ```
 */
export function useTranslation(): I18nContextState {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error('useTranslation must be used within an I18nProvider');
  }
  return context;
}

export { I18nContext };
