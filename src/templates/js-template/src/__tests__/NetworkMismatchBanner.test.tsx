/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Networks } from "@stellar/stellar-sdk";

// Same ESM-mocking approach as the minimal template's
// NetworkMismatchBanner.test.tsx: this repo's root jest config maps the
// literal specifiers `../contexts` and `../contexts/WalletProvider` to a
// shared mock module intended for hook tests elsewhere in the repo, which
// shadows the real WalletContext/WalletConfigContext this component's
// siblings (e.g. WalletConnectButton.stories.jsx) import directly. Mocking
// `../contexts` ourselves, via jest.unstable_mockModule (the ESM-native
// equivalent of jest.mock() under this repo's --experimental-vm-modules
// setup), sidesteps that collision entirely.
const mockUseWallet = jest.fn();
const mockUseWalletConfig = jest.fn();

await jest.unstable_mockModule("../contexts", () => ({
  useWallet: mockUseWallet,
  useWalletConfig: mockUseWalletConfig,
}));

// `kit()` is imported eagerly (not lazily) by NetworkMismatchBanner.jsx in
// this template, so it must be mocked before the component is imported.
const mockGetNetwork = jest.fn();
await jest.unstable_mockModule("../lib/stellar-wallet-kit", () => ({
  kit: () => ({ getNetwork: mockGetNetwork }),
}));

const { default: NetworkMismatchBanner } = await import(
  "../components/NetworkMismatchBanner.jsx"
);

function setContext({
  connected = true,
  disconnect = jest.fn(),
  network = Networks.TESTNET,
}: {
  connected?: boolean;
  disconnect?: () => void;
  network?: string;
} = {}) {
  mockUseWallet.mockReturnValue({
    connected,
    publicKey: connected ? "GABC...MOCK" : undefined,
    walletName: connected ? "Freighter" : undefined,
    balances: [],
    connect: jest.fn(async () => {}),
    disconnect,
    refreshBalances: jest.fn(async () => {}),
    sendPayment: undefined,
  });
  mockUseWalletConfig.mockReturnValue({
    horizonUrl: "https://horizon-testnet.stellar.org",
    network,
    sorobanUrl: "https://soroban-testnet.stellar.org",
  });
}

describe("NetworkMismatchBanner (js-template)", () => {
  beforeEach(() => {
    mockUseWallet.mockReset();
    mockUseWalletConfig.mockReset();
    mockGetNetwork.mockReset();
  });

  it("renders nothing when no wallet is connected", () => {
    setContext({ connected: false });
    render(
      <NetworkMismatchBanner walletNetworkPassphrase={Networks.PUBLIC} />
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders nothing when the wallet hasn't reported a network yet", () => {
    setContext();
    render(<NetworkMismatchBanner walletNetworkPassphrase={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders nothing when the wallet's network matches the app's configured network", () => {
    setContext({ network: Networks.TESTNET });
    render(
      <NetworkMismatchBanner walletNetworkPassphrase={Networks.TESTNET} />
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a warning when the wallet is on mainnet but the app is configured for testnet", () => {
    setContext({ network: Networks.TESTNET });
    render(
      <NetworkMismatchBanner walletNetworkPassphrase={Networks.PUBLIC} />
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Mainnet");
    expect(alert).toHaveTextContent("Testnet");
  });

  it("renders a warning when the wallet is on testnet but the app is configured for mainnet", () => {
    setContext({ network: Networks.PUBLIC });
    render(
      <NetworkMismatchBanner walletNetworkPassphrase={Networks.TESTNET} />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("falls back to the raw passphrase for an unnamed network", () => {
    const customPassphrase = "Custom Standalone Network ; October 2026";
    setContext({ network: Networks.TESTNET });
    render(
      <NetworkMismatchBanner walletNetworkPassphrase={customPassphrase} />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(customPassphrase);
  });

  it("calls the wallet context's disconnect when Disconnect is clicked, by default", () => {
    const disconnect = jest.fn();
    setContext({ network: Networks.TESTNET, disconnect });
    render(
      <NetworkMismatchBanner walletNetworkPassphrase={Networks.PUBLIC} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("calls a supplied onDisconnect instead of the context's disconnect when given", () => {
    const disconnect = jest.fn();
    const onDisconnect = jest.fn();
    setContext({ network: Networks.TESTNET, disconnect });
    render(
      <NetworkMismatchBanner
        walletNetworkPassphrase={Networks.PUBLIC}
        onDisconnect={onDisconnect}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it("asks the wallet kit for its network and renders the mismatch once reported (uncontrolled mode)", async () => {
    setContext({ network: Networks.TESTNET });
    mockGetNetwork.mockResolvedValue({
      network: "PUBLIC",
      networkPassphrase: Networks.PUBLIC,
    });
    render(<NetworkMismatchBanner />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Mainnet");
  });
});
