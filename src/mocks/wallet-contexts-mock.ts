/**
 * Mock for template contexts module (WalletProvider).
 * Returns undefined from useWalletConfig so hooks fall back to defaults.
 * Mapped via jest.config moduleNameMapper for '../contexts' imports.
 */

export function useWalletConfig() {
  return undefined;
}

export function useWallet() {
  throw new Error('useWallet must be used within a WalletProvider');
}

export function WalletProvider() {
  throw new Error('WalletProvider is not available in tests');
}
