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
import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";

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

export function useWallet(): MockWalletState {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
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
