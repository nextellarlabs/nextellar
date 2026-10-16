/**
 * @jest-environment jsdom
 *
 * WalletConnectButton opt-in flows:
 * - walletSelector="builtin" opens WalletSelectModal (#911)
 * - confirmDisconnect asks before disconnecting (#910)
 * - "Reconnecting..." while a persisted session is restored (#910)
 *
 * Default behaviour (kit modal, one-click disconnect) is covered by
 * WalletConnectButton.test.tsx and must stay unchanged.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
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
    useStellarBalances: jest.fn(() => ({
      balances: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      stopPolling: jest.fn(),
    })),
  }),
);

const [{ default: WalletConnectButton }, { useWallet }] = await Promise.all([
  import("../../src/templates/default/src/components/WalletConnectButton"),
  import("../../src/mocks/wallet-contexts-mock"),
]);

const WALLETS = [
  {
    id: "freighter",
    name: "Freighter",
    icon: "https://example.test/freighter.png",
    isAvailable: true,
  },
  {
    id: "xbull",
    name: "xBull",
    icon: "https://example.test/xbull.png",
    isAvailable: false,
    url: "https://xbull.app",
  },
];

type State = {
  connected: boolean;
  connect: jest.Mock;
  disconnect: jest.Mock;
  getWallets?: jest.Mock;
  reconnecting?: boolean;
  walletName?: string;
  accounts: unknown[];
  publicKey?: string;
};

function mockWallet(partial: Partial<State> = {}) {
  const state: State = {
    connected: false,
    connect: jest.fn(async () => {}),
    disconnect: jest.fn(async () => {}),
    getWallets: jest.fn(async () => WALLETS),
    accounts: [],
    ...partial,
  };
  (useWallet as unknown as jest.Mock).mockReturnValue(state);
  return state;
}

describe("WalletConnectButton wallet selection (#911)", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("opens the built-in modal listing wallets with icons", async () => {
    const state = mockWallet();
    render(<WalletConnectButton walletSelector="builtin" />);

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));

    expect(
      await screen.findByRole("dialog", { name: "Connect a wallet" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Freighter")).toBeInTheDocument();
    expect(state.getWallets).toHaveBeenCalledTimes(1);
    expect(state.connect).not.toHaveBeenCalled();
  });

  it("connects the chosen wallet and closes the modal", async () => {
    const state = mockWallet();
    render(<WalletConnectButton walletSelector="builtin" />);

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Freighter" }));

    await waitFor(() =>
      expect(state.connect).toHaveBeenCalledWith("freighter"),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a connect failure after choosing a wallet", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockWallet({
      connect: jest.fn(async () => {
        throw new Error("User rejected");
      }),
    });
    render(<WalletConnectButton walletSelector="builtin" />);

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Freighter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("User rejected");
  });

  it("shows an error inside the modal when wallets fail to load", async () => {
    mockWallet({
      getWallets: jest.fn(async () => {
        throw new Error("Kit unavailable");
      }),
    });
    render(<WalletConnectButton walletSelector="builtin" />);

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));

    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog).toHaveTextContent("Kit unavailable"),
    );
  });

  it("closes the modal on Escape without connecting", async () => {
    const state = mockWallet();
    render(<WalletConnectButton walletSelector="builtin" />);

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(state.connect).not.toHaveBeenCalled();
  });

  it("falls back to the kit modal when the provider cannot list wallets", async () => {
    const state = mockWallet({ getWallets: undefined });
    render(<WalletConnectButton walletSelector="builtin" />);

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));

    await waitFor(() => expect(state.connect).toHaveBeenCalledWith());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the kit modal by default", async () => {
    const state = mockWallet();
    render(<WalletConnectButton />);

    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));

    await waitFor(() => expect(state.connect).toHaveBeenCalledWith());
    expect(state.getWallets).not.toHaveBeenCalled();
  });
});

describe("WalletConnectButton disconnect confirmation (#910)", () => {
  beforeEach(() => jest.clearAllMocks());

  const connectedState = () =>
    mockWallet({ connected: true, walletName: "Freighter", publicKey: "GABC" });

  it("asks before disconnecting and disconnects on confirm", async () => {
    const state = connectedState();
    render(<WalletConnectButton confirmDisconnect />);

    fireEvent.click(
      screen.getByRole("button", { name: "Disconnect Freighter" }),
    );
    expect(state.disconnect).not.toHaveBeenCalled();

    const dialog = screen.getByRole("alertdialog", {
      name: "Disconnect Freighter?",
    });
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).find(
        (b) => b.textContent === "Disconnect",
      )!,
    );

    await waitFor(() => expect(state.disconnect).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps the session when cancelled", () => {
    const state = connectedState();
    render(<WalletConnectButton confirmDisconnect />);

    fireEvent.click(
      screen.getByRole("button", { name: "Disconnect Freighter" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(state.disconnect).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("disconnects in one click when confirmation is off (default)", async () => {
    const state = connectedState();
    render(<WalletConnectButton />);

    fireEvent.click(
      screen.getByRole("button", { name: "Disconnect Freighter" }),
    );

    await waitFor(() => expect(state.disconnect).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("WalletConnectButton persisted session (#910)", () => {
  it("shows a disabled Reconnecting state while a session is restored", () => {
    mockWallet({ reconnecting: true });
    render(<WalletConnectButton />);

    const button = screen.getByRole("button", { name: "Reconnecting..." });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("shows the connected state once restored", () => {
    mockWallet({ reconnecting: false, connected: true, walletName: "Freighter" });
    render(<WalletConnectButton />);

    expect(
      screen.getByRole("button", { name: "Disconnect Freighter" }),
    ).toBeEnabled();
  });
});
