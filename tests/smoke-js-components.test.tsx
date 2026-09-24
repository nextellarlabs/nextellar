/**
 * @jest-environment jsdom
 *
 * Smoke test for JavaScript template components (#894).
 * Imports and renders each .jsx component in src/templates/js-template and
 * src/templates/js-defi to verify they all mount cleanly without runtime error.
 */
import React from "react";
import { render, screen, act } from "@testing-library/react";
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
  { default: JsErrorBoundary },
  { default: JsNetworkSwitcher },
  { default: JsWalletConnectButton },
  { default: DefiErrorBoundary },
  { default: DefiNetworkSwitcher },
  { default: DefiWalletConnectButton },
  { useWallet },
] = await Promise.all([
  import("../src/templates/js-template/src/components/ErrorBoundary"),
  import("../src/templates/js-template/src/components/NetworkSwitcher"),
  import("../src/templates/js-template/src/components/WalletConnectButton"),
  import("../src/templates/js-defi/src/components/ErrorBoundary"),
  import("../src/templates/js-defi/src/components/NetworkSwitcher"),
  import("../src/templates/js-defi/src/components/WalletConnectButton"),
  import("../src/mocks/wallet-contexts-mock"),
]);

describe("js-template components smoke tests (#894)", () => {
  it("renders ErrorBoundary cleanly with children", () => {
    const { container } = render(
      <JsErrorBoundary>
        <div>JS template child content</div>
      </JsErrorBoundary>,
    );
    expect(container).toBeInTheDocument();
    expect(screen.getByText("JS template child content")).toBeInTheDocument();
  });

  it("renders NetworkSwitcher cleanly", async () => {
    let renderResult: ReturnType<typeof render>;
    await act(async () => {
      renderResult = render(<JsNetworkSwitcher />);
    });
    expect(renderResult!.container).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Network" }),
    ).toBeInTheDocument();
  });

  it("renders WalletConnectButton cleanly when disconnected", () => {
    const { container } = render(<JsWalletConnectButton />);
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

    const { container } = render(<JsWalletConnectButton />);
    expect(container).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Disconnect Freighter/i }),
    ).toBeInTheDocument();
  });
});

describe("js-defi components smoke tests (#894)", () => {
  it("renders ErrorBoundary cleanly with children", () => {
    const { container } = render(
      <DefiErrorBoundary>
        <div>JS defi child content</div>
      </DefiErrorBoundary>,
    );
    expect(container).toBeInTheDocument();
    expect(screen.getByText("JS defi child content")).toBeInTheDocument();
  });

  it("renders NetworkSwitcher cleanly", async () => {
    let renderResult: ReturnType<typeof render>;
    await act(async () => {
      renderResult = render(<DefiNetworkSwitcher />);
    });
    expect(renderResult!.container).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Network" }),
    ).toBeInTheDocument();
  });

  it("renders WalletConnectButton cleanly when disconnected", () => {
    const { container } = render(<DefiWalletConnectButton />);
    expect(container).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Connect Wallet/i }),
    ).toBeInTheDocument();
  });

  it("renders WalletConnectButton cleanly when connected", () => {
    (useWallet as jest.Mock).mockReturnValueOnce({
      connected: true,
      walletName: "Albedo",
      connect: jest.fn(),
      disconnect: jest.fn(),
      accounts: [{ address: "GABC123" }],
    });

    const { container } = render(<DefiWalletConnectButton />);
    expect(container).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Disconnect Albedo/i }),
    ).toBeInTheDocument();
  });
});
