/**
 * @jest-environment jsdom
 *
 * Smoke test for defi template components (#892).
 * Imports and renders each component in src/templates/defi/src/components
 * to verify they all mount cleanly without runtime error.
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

const mockContract = {
  callFunction: jest.fn().mockResolvedValue(0),
  buildInvokeXDR: jest.fn().mockResolvedValue("AAAA..."),
  submitInvokeWithSecret: jest.fn(),
  loading: false,
  error: null,
};

jest.unstable_mockModule("@/hooks/useSorobanContract", () => ({
  useSorobanContract: jest.fn(() => mockContract),
  isValidContractId: jest.fn(() => true),
}));

class MockCounterClient {
  initialize = jest.fn().mockResolvedValue(undefined);
  getCount = jest.fn().mockResolvedValue(0);
  increment = jest.fn().mockResolvedValue(1);
  decrement = jest.fn().mockResolvedValue(0);
  add = jest.fn().mockResolvedValue(10);
  reset = jest.fn().mockResolvedValue(undefined);
}

jest.unstable_mockModule("@/lib/contracts", () => ({
  CONTRACTS: {
    COUNTER: "CA3D5KRYMCMUZGAMBLQEMUUHAITMMWLIW6CCIPDX2BIHAISRENO9BK37",
    HELLO_WORLD: "CBHQ5B2DXV2637CG72Q6D37G4L5B4D2R46O7EUPGCS5752QPB2T2MOHG",
  },
  CounterClient: MockCounterClient,
}));

const [
  { default: CounterDemo },
  { default: ErrorBoundary },
  { default: NetworkSwitcher },
  { default: WalletConnectButton },
  { useWallet },
] = await Promise.all([
  import("../src/templates/defi/src/components/CounterDemo"),
  import("../src/templates/defi/src/components/ErrorBoundary"),
  import("../src/templates/defi/src/components/NetworkSwitcher"),
  import("../src/templates/defi/src/components/WalletConnectButton"),
  import("../src/mocks/wallet-contexts-mock"),
]);

describe("defi template components smoke tests (#892)", () => {
  it("renders CounterDemo cleanly", async () => {
    let renderResult: ReturnType<typeof render>;
    await act(async () => {
      renderResult = render(<CounterDemo />);
    });
    expect(renderResult!.container).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Counter Contract Demo/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Interact with a Soroban smart contract on Stellar/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Increment count/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Decrement count/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Refresh Count/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /CA3D5KRYMCMUZGAMBLQEMUUHAITMMWLIW6CCIPDX2BIHAISRENO9BK37/i,
      ),
    ).toBeInTheDocument();
  });

  it("renders ErrorBoundary cleanly with children", () => {
    const { container } = render(
      <ErrorBoundary>
        <div>DeFi child content</div>
      </ErrorBoundary>,
    );
    expect(container).toBeInTheDocument();
    expect(screen.getByText("DeFi child content")).toBeInTheDocument();
  });

  it("renders NetworkSwitcher cleanly", () => {
    const { container } = render(<NetworkSwitcher />);
    expect(container).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Network" }),
    ).toBeInTheDocument();
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
