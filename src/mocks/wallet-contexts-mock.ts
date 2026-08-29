/**
 * Mock for template contexts module (WalletProvider).
 * Returns undefined from useWalletConfig so hooks fall back to defaults.
 * Mapped via jest.config moduleNameMapper for '../contexts' imports.
 */
import { createContext, useContext } from 'react';

export function useWalletConfig() {
  return undefined;
}

/**
 * Real React Context (not just a mocked function) so component tests can
 * inject wallet state via `<WalletContext.Provider value={...}>`, matching
 * how the real WalletProvider exposes it. Consumers that don't wrap in a
 * Provider get the exact same "must be used within a WalletProvider" throw
 * as before — this is purely additive.
 */
export const WalletContext = createContext(undefined);
export const WalletConfigContext = createContext(undefined);

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (ctx === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return ctx;
}

export function WalletProvider() {
  throw new Error('WalletProvider is not available in tests');
}
