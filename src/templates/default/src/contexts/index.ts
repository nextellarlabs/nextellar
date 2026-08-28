/**
 * Re-export wallet context for easy imports
 */
export { WalletProvider, useWallet, useWalletConfig } from './WalletProvider';
export type { Balance, PaymentOptions } from './WalletProvider';

/**
 * Re-export theme context for easy imports
 */
export { ThemeProvider, useTheme } from './ThemeProvider';
export type { Theme } from './ThemeProvider';

/**
 * Re-export i18n context for easy imports. Optional — not wired into
 * layout.tsx by default. See I18nProvider's doc comment to opt in.
 */
export { I18nProvider, useTranslation, locales } from './I18nProvider';
export type { Locale, Messages } from './I18nProvider';
