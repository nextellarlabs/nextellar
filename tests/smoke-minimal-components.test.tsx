/**
 * @jest-environment jsdom
 *
 * Smoke test for minimal template components (#893).
 * Imports and renders each component in src/templates/minimal/src/components
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
  { default: ErrorBoundary },
  { default: WalletConnectButton },
  { useWallet },
] = await Promise.all([
  import("../src/templates/minimal/src/components/ErrorBoundary"),
  import("../src/templates/minimal/src/components/WalletConnectButton"),
  import("../src/mocks/wallet-contexts-mock"),
]);

describe("minimal template components smoke tests (#893)", () => {
  it("renders ErrorBoundary cleanly with children", () => {
    const { container } = render(
      <ErrorBoundary>
        <div>Minimal child content</div>
      </ErrorBoundary>,
    );
    expect(container).toBeInTheDocument();
    expect(screen.getByText("Minimal child content")).toBeInTheDocument();
  });

  it("renders WalletConnectButton cleanly when disconnected", () => {
    const { container } = render(<WalletConnectButton />);
    expect(container).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Connect Wallet/i }),
    ).toBeInTheDocument();
  });

  it("renders WalletConnectButton cleanly when connected", () => {
    (useWallet as jest.Mock).mockReturnValueOnce({
      connected: true,
      walletName: "Freighter",
      connect: jest.fn(),
      disconnect: jest.fn(),
      accounts: [{ address: "GABC123" }],
    });

    const { container } = render(<WalletConnectButton />);
    expect(container).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Disconnect Freighter/i }),
    ).toBeInTheDocument();
  });
});
