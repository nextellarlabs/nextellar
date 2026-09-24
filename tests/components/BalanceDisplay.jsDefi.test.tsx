/**
 * @jest-environment jsdom
 *
 * BalanceDisplay Component Tests — js-defi (#839)
 */
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import React from "react";

jest.unstable_mockModule("../../src/mocks/wallet-contexts-mock", () => ({
  useWallet: jest.fn(),
  useWalletConfig: jest.fn(() => undefined),
  WalletProvider: jest.fn(
    ({ children }: { children: React.ReactNode }) => children,
  ),
}));

jest.unstable_mockModule(
  "../../src/templates/js-defi/src/hooks/useStellarBalances",
  () => ({
    useStellarBalances: jest.fn(),
  }),
);

const [{ default: BalanceDisplay }, { useStellarBalances }, { useWallet }] =
  await Promise.all([
    import("../../src/templates/js-defi/src/components/BalanceDisplay"),
    import("../../src/templates/js-defi/src/hooks/useStellarBalances"),
    import("../../src/mocks/wallet-contexts-mock"),
  ]);

const PUBLIC_KEY = "GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";

function mockWallet(overrides: Record<string, unknown> = {}) {
  (useWallet as jest.Mock).mockReturnValue({
    connected: true,
    publicKey: PUBLIC_KEY,
    ...overrides,
  });
}

function mockBalances(overrides: Record<string, unknown> = {}) {
  (useStellarBalances as jest.Mock).mockReturnValue({
    balances: [],
    loading: false,
    error: null,
    refresh: jest.fn(),
    stopPolling: jest.fn(),
    ...overrides,
  });
}

describe("BalanceDisplay (js-defi)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows a connect-wallet prompt when disconnected", () => {
    mockWallet({ connected: false, publicKey: undefined });
    mockBalances();
    render(<BalanceDisplay />);
    expect(
      screen.getByText(/connect a wallet to view balances/i),
    ).toBeInTheDocument();
  });

  it("shows a loading state while the initial fetch is in flight", () => {
    mockWallet();
    mockBalances({ loading: true });
    render(<BalanceDisplay />);
    expect(
      screen.getByRole("status", { name: /loading balances/i }),
    ).toBeInTheDocument();
  });

  it("shows an error message with a working retry button", () => {
    mockWallet();
    const refresh = jest.fn();
    mockBalances({ error: new Error("Network error: timeout"), refresh });
    render(<BalanceDisplay />);
    expect(screen.getByText(/couldn't load balances/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state for a connected account with no balances", () => {
    mockWallet();
    mockBalances();
    render(<BalanceDisplay />);
    expect(screen.getByText(/no balances found/i)).toBeInTheDocument();
  });

  it("renders native and credit-asset balances with formatting", () => {
    mockWallet();
    mockBalances({
      balances: [
        { asset_type: "native", balance: "100.0000000" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer:
            "GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234",
          balance: "250.5000000",
        },
      ],
    });
    render(<BalanceDisplay />);
    expect(screen.getByText("XLM")).toBeInTheDocument();
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.getByText(/250\.5/)).toBeInTheDocument();
  });
});
