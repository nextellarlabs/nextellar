/**
 * Test stand-in for template `../contexts` (WalletProvider).
 *
 * Mapped via jest.config `moduleNameMapper` so template components/hooks that
 * import `../contexts` get this module instead of the real provider (which
 * pulls in `@stellar/stellar-sdk` and the wallet kit).
 *
 * Unlike the previous throw-on-use stub, this is a real React context so
 * `renderWithProviders` in `tests/test-utils` can drive `useWallet()` /
 * `useWalletConfig()` with fixture state. `useWalletConfig()` still returns
 * `undefined` when no config value is provided, matching the hooks' standalone
 * fallback path.
 */
import { createContext, useContext } from 'react';

export type MockWalletAccount = {
  address: string;
  displayName?: string;
};

export type MockBalance = {
  balance: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
};

export type MockWalletState = {
  connected: boolean;
  publicKey?: string;
  walletName?: string;
  balances: MockBalance[];
  accounts: MockWalletAccount[];
  currentAccountIndex: number;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
  switchAccount: (address: string) => Promise<void>;
  sendPayment?: (...args: unknown[]) => Promise<unknown>;
};

export type MockWalletConfig = {
  activeNetworkKey: string;
  horizonUrl: string;
  sorobanUrl: string;
  network: string;
  switchNetwork: (networkKey: string) => void;
};

const noopAsync = async () => {};
const noop = () => {};

function defaultWalletState(): MockWalletState {
  return {
    connected: false,
    balances: [],
    accounts: [],
    currentAccountIndex: 0,
    connect: noopAsync,
    disconnect: noop,
    refreshBalances: noopAsync,
    switchAccount: noopAsync,
  };
}

export const WalletContext = createContext<MockWalletState | undefined>(
  undefined,
);
export const WalletConfigContext = createContext<
  MockWalletConfig | undefined
>(undefined);

export function useWalletConfig(): MockWalletConfig | undefined {
  return useContext(WalletConfigContext);
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

export function WalletProvider({
  children,
  value,
}: {
  children: ReactNode;
  value?: MockWalletState;
}) {
  return createElement(
    WalletContext.Provider,
    { value: value ?? defaultWalletState() },
    children,
  );
}
