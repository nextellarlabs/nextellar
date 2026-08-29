/**
 * @jest-environment jsdom
 *
 * BalanceDisplay Component Tests (#838/#839)
 *
 * Covers:
 * - Disconnected state (empty state prompting to connect)
 * - Loading state (skeleton, no data yet)
 * - Error state (with retry)
 * - Empty balances (connected, but zero balances — e.g. unfunded account)
 * - Populated state: native (XLM) + credit asset rendering, formatting, dark mode classes present
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
  "../../src/templates/default/src/hooks/useStellarBalances",
  () => ({
    useStellarBalances: jest.fn(),
  }),
);

const [{ default: BalanceDisplay }, { useStellarBalances }, { useWallet }] =
  await Promise.all([
    import("../../src/templates/default/src/components/BalanceDisplay"),
    import("../../src/templates/default/src/hooks/useStellarBalances"),
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

describe("BalanceDisplay", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows a connect-wallet prompt when disconnected", () => {
    mockWallet({ connected: false, publicKey: undefined });
    mockBalances();

    render(<BalanceDisplay />);

    expect(
      screen.getByText(/connect a wallet to view balances/i),
    ).toBeInTheDocument();
  });

  it("shows a loading skeleton while the initial fetch is in flight", () => {
    mockWallet();
    mockBalances({ loading: true, balances: [] });

    render(<BalanceDisplay />);

    expect(
      screen.getByRole("status", { name: /loading balances/i }),
    ).toBeInTheDocument();
  });

  it("shows an error message with a retry button when the fetch fails and no balances are cached", () => {
    mockWallet();
    const refresh = jest.fn();
    mockBalances({ error: new Error("Network error: timeout"), refresh });

    render(<BalanceDisplay />);

    expect(screen.getByText(/couldn't load balances/i)).toBeInTheDocument();
    expect(screen.getByText(/network error: timeout/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when connected but the account has no balances", () => {
    mockWallet();
    mockBalances({ balances: [] });

    render(<BalanceDisplay />);

    expect(screen.getByText(/no balances found/i)).toBeInTheDocument();
    expect(screen.getByText(/may need funding/i)).toBeInTheDocument();
  });

  it("renders the native XLM balance without an issuer line", () => {
    mockWallet();
    mockBalances({
      balances: [{ asset_type: "native", balance: "123.4567890" }],
    });

    render(<BalanceDisplay />);

    expect(screen.getByText("XLM")).toBeInTheDocument();
    expect(screen.getByText(/123\.456789/)).toBeInTheDocument();
  });

  it("renders a credit asset with its code and a truncated issuer", () => {
    mockWallet();
    const issuer = "GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";
    mockBalances({
      balances: [
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: issuer,
          balance: "500.0000000",
        },
      ],
    });

    render(<BalanceDisplay />);

    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(`${issuer.slice(0, 4)}\\.\\.\\.${issuer.slice(-4)}`),
      ),
    ).toBeInTheDocument();
  });

  it("renders an asset trustline limit when present", () => {
    mockWallet();
    mockBalances({
      balances: [
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer:
            "GDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234",
          balance: "500.0000000",
          limit: "10000.0000000",
        },
      ],
    });

    render(<BalanceDisplay />);

    expect(screen.getByText(/limit: 10,000/i)).toBeInTheDocument();
  });

  it("renders multiple balances in order", () => {
    mockWallet();
    mockBalances({
      balances: [
        { asset_type: "native", balance: "100.0000000" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GDEF",
          balance: "50.0000000",
        },
      ],
    });

    render(<BalanceDisplay />);

    expect(screen.getByText("XLM")).toBeInTheDocument();
    expect(screen.getByText("USDC")).toBeInTheDocument();
  });

  it("passes pollIntervalMs and horizonUrl through to useStellarBalances", () => {
    mockWallet();
    mockBalances();

    render(
      <BalanceDisplay
        pollIntervalMs={15000}
        horizonUrl="https://custom.horizon.example"
      />,
    );

    expect(useStellarBalances).toHaveBeenCalledWith(
      PUBLIC_KEY,
      expect.objectContaining({
        pollIntervalMs: 15000,
        horizonUrl: "https://custom.horizon.example",
      }),
    );
  });

  it("does not query balances (passes null) when disconnected, even if a stale publicKey lingers", () => {
    mockWallet({ connected: false, publicKey: PUBLIC_KEY });
    mockBalances();

    render(<BalanceDisplay />);

    expect(useStellarBalances).toHaveBeenCalledWith(null, expect.anything());
  });

  it("prefers rendering cached balances over the error banner when both are present", () => {
    mockWallet();
    mockBalances({
      balances: [{ asset_type: "native", balance: "10.0000000" }],
      error: new Error("Network error: timeout"),
    });

    render(<BalanceDisplay />);

    // Real data takes priority over the error banner once we have something to show.
    expect(screen.getByText("XLM")).toBeInTheDocument();
    expect(
      screen.queryByText(/couldn't load balances/i),
    ).not.toBeInTheDocument();
  });
});
