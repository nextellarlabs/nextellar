/**
 * @jest-environment jsdom
 *
 * Smoke test for default template components (#891).
 * Imports and renders each component in src/templates/default/src/components
 * to verify they all mount cleanly without runtime error.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { jest, describe, it, expect } from "@jest/globals";

const mockWallet = {
  connected: false,
  connect: jest.fn(),
  disconnect: jest.fn(),
  walletName: undefined,
  accounts: [],
  currentAccountIndex: 0,
  publicKey: undefined,
  switchAccount: jest.fn(),
};

const mockConfig = {
  activeNetworkKey: "testnet",
  switchNetwork: jest.fn(),
  horizonUrl: "https://horizon-testnet.stellar.org",
};

jest.unstable_mockModule("../src/mocks/wallet-contexts-mock", () => ({
  useWallet: jest.fn(() => mockWallet),
  useWalletConfig: jest.fn(() => mockConfig),
  WalletProvider: jest.fn(
    ({ children }: { children: React.ReactNode }) => children,
  ),
}));

const [
  { default: AccountSwitcher },
  { default: BalanceDisplay },
  { default: EmptyState },
  { default: ErrorBoundary },
  { default: LoadingBoundary },
  { default: NetworkSwitcher },
  { Skeleton, SkeletonList },
  { default: ThemeToggle },
  { ThemeProvider },
  { default: TransactionList },
  { default: TransactionStatusBadge },
  { default: WalletConnectButton },
  { useWallet },
] = await Promise.all([
  import("../src/templates/default/src/components/AccountSwitcher"),
  import("../src/templates/default/src/components/BalanceDisplay"),
  import("../src/templates/default/src/components/EmptyState"),
  import("../src/templates/default/src/components/ErrorBoundary"),
  import("../src/templates/default/src/components/LoadingBoundary"),
  import("../src/templates/default/src/components/NetworkSwitcher"),
  import("../src/templates/default/src/components/Skeleton"),
  import("../src/templates/default/src/components/ThemeToggle"),
  import("../src/templates/default/src/contexts/ThemeProvider"),
  import("../src/templates/default/src/components/TransactionList"),
  import("../src/templates/default/src/components/TransactionStatusBadge"),
  import("../src/templates/default/src/components/WalletConnectButton"),
  import("../src/mocks/wallet-contexts-mock"),
]);

describe("default template components smoke tests (#891)", () => {
  it("renders BalanceDisplay cleanly", () => {
    const { container } = render(<BalanceDisplay />);
    expect(container).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/connect wallet/i);
  });

  it("renders AccountSwitcher cleanly when disconnected", () => {
    const { container } = render(<AccountSwitcher />);
    expect(container).toBeInTheDocument();
  });

  it("renders AccountSwitcher cleanly when connected with accounts", () => {
    (useWallet as jest.Mock).mockReturnValueOnce({
      connected: true,
      accounts: [
        { address: "GABC123", displayName: "Account 1" },
        { address: "GDEF456", displayName: "Account 2" },
      ],
      currentAccountIndex: 0,
      publicKey: "GABC123",
      switchAccount: jest.fn(),
    });

    const { container } = render(<AccountSwitcher />);
    expect(container).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Account 1/ }),
    ).toBeInTheDocument();
  });

  it("renders EmptyState cleanly", () => {
    const { container } = render(
      <EmptyState
        title="No transactions yet"
        description="Your transactions will appear here"
        action={<button>Refresh</button>}
      />,
    );
    expect(container).toBeInTheDocument();
    expect(screen.getByText("No transactions yet")).toBeInTheDocument();
    expect(
      screen.getByText("Your transactions will appear here"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("renders ErrorBoundary cleanly with children", () => {
    const { container } = render(
      <ErrorBoundary>
        <div>Content within ErrorBoundary</div>
      </ErrorBoundary>,
    );
    expect(container).toBeInTheDocument();
    expect(
      screen.getByText("Content within ErrorBoundary"),
    ).toBeInTheDocument();
  });

  it("renders LoadingBoundary cleanly with children", () => {
    const { container } = render(
      <LoadingBoundary label="Loading items" rows={3}>
        <div>Loaded content</div>
      </LoadingBoundary>,
    );
    expect(container).toBeInTheDocument();
    expect(screen.getByText("Loaded content")).toBeInTheDocument();
  });

  it("renders NetworkSwitcher cleanly", () => {
    const { container } = render(<NetworkSwitcher />);
    expect(container).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Network" }),
    ).toBeInTheDocument();
  });

  it("renders Skeleton cleanly", () => {
    const { container } = render(
      <Skeleton width="w-24" height="h-6" className="test-skeleton" />,
    );
    expect(container.firstChild).toBeInTheDocument();
    expect(container.querySelector(".test-skeleton")).toBeInTheDocument();
  });

  it("renders SkeletonList cleanly", () => {
    const { container } = render(
      <SkeletonList rows={3} label="Loading data" />,
    );
    expect(container).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Loading data" }),
    ).toBeInTheDocument();
  });

  it("renders ThemeToggle cleanly within ThemeProvider", () => {
    const { container } = render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(container).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Theme" }),
    ).toBeInTheDocument();
  });

  it("renders TransactionList cleanly", () => {
    const { container } = render(
      <TransactionList limit={5} type="operations" />,
    );
    expect(container).toBeInTheDocument();
    expect(
      screen.getByText(/Connect wallet to view transactions/i),
    ).toBeInTheDocument();
  });

  it.each(["pending", "success", "failed"] as const)(
    "renders TransactionStatusBadge cleanly for status: %s",
    (status) => {
      const { container } = render(<TransactionStatusBadge status={status} />);
      expect(container.firstChild).toBeInTheDocument();
      expect(screen.getByRole("status")).toBeInTheDocument();
    },
  );

  it("renders WalletConnectButton cleanly", () => {
    const { container } = render(<WalletConnectButton />);
    expect(container).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect Stellar wallet" }),
    ).toBeInTheDocument();
  });
});
