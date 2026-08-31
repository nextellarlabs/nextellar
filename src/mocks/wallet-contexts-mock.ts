/**
 * Mock for template contexts module (WalletProvider).
 * Mapped via jest.config moduleNameMapper for '../contexts' and
 * '../contexts/WalletProvider' imports.
 *
 * Hooks under test (useStellarBalances, useTrustlines, …) only need
 * `useWalletConfig` to return undefined so they fall back to their defaults.
 *
 * Component tests, however, render against a real context — they import
 * `WalletContext` and wrap the component in `WalletContext.Provider` with a
 * hand-built wallet state. So this mock exposes a genuine context rather than
 * a throwing stub, and `useWallet` reads from it.
 */
import { createContext, useContext } from 'react';

export interface WalletAccount {
  address: string;
  name?: string;
  index?: number;
}

// Intentionally loose: each template's WalletContextState differs slightly, and
// component tests supply whichever subset of fields the component reads.
export type WalletContextState = Record<string, unknown>;

export const WalletContext = createContext<WalletContextState | undefined>(undefined);
export const WalletConfigContext = createContext<unknown>(undefined);

export function useWalletConfig() {
  return undefined;
}

export function useWallet(): WalletContextState {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}

/**
 * Real React Context (not just a mocked function) so component tests can
 * inject wallet state via `<WalletContext.Provider value={...}>`, matching
 * how the real WalletProvider exposes it. Consumers that don't wrap in a
 * Provider get the exact same "must be used within a WalletProvider" throw
 * as before — this is purely additive.
 */

export function WalletProvider() {
  throw new Error('WalletProvider is not available in tests');
}
