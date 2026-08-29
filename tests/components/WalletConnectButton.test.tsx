/**
 * @jest-environment jsdom
 *
 * WalletConnectButton Component Tests
 *
 * Renders the real component rather than asserting against hand-written
 * mock objects, so the button's actual wiring to the wallet context is
 * what is under test.
 *
 * Covers:
 * - Disconnected state and the connect action
 * - Connected state and the disconnect action
 * - In-flight labelling and the disabled guard
 * - Failure handling for both actions
 * - Theme styling and the AccountSwitcher slot
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

// ── Mock the wallet contexts module ───────────────────────────────────────────
// WalletConnectButton imports useWallet from '../contexts', which
// jest.config.mjs maps to src/mocks/wallet-contexts-mock.
jest.unstable_mockModule("../../src/mocks/wallet-contexts-mock", () => ({
  useWallet: jest.fn(),
  useWalletConfig: jest.fn(() => undefined),
  WalletProvider: jest.fn(
    ({ children }: { children: React.ReactNode }) => children,
  ),
}));

// ── Dynamic imports (must come after unstable_mockModule) ─────────────────────
const [{ default: WalletConnectButton }, { useWallet }] = await Promise.all([
  import("../../src/templates/default/src/components/WalletConnectButton"),
  import("../../src/mocks/wallet-contexts-mock"),
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACCOUNT_A = "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234";
const ACCOUNT_B =
  "GXYZ7890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCD";

type WalletState = {
  connected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  walletName?: string;
  accounts: string[];
  currentAccountIndex: number;
  switchAccount: (address: string) => Promise<void>;
  publicKey?: string;
};

/** Configures useWallet for a single test, filling in inert defaults. */
function mockWallet(partial: Partial<WalletState> = {}) {
  const state: WalletState = {
    connected: false,
    connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    disconnect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    walletName: undefined,
    accounts: [],
    currentAccountIndex: 0,
    switchAccount: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    publicKey: undefined,
    ...partial,
  };
  (useWallet as unknown as jest.Mock).mockReturnValue(state);
  return state;
}

/** The primary connect/disconnect button. */
function getActionButton() {
  return screen.getByRole("button", {
    name: /connect wallet|disconnect|connecting|disconnecting/i,
  });
}

describe("WalletConnectButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("disconnected state", () => {
    it('renders a "Connect Wallet" button', () => {
      mockWallet({ connected: false });

      render(<WalletConnectButton />);

      expect(
        screen.getByRole("button", { name: /connect wallet/i }),
      ).toBeInTheDocument();
    });

    it("calls connect when the button is clicked", async () => {
      const state = mockWallet({ connected: false });

      render(<WalletConnectButton />);
      fireEvent.click(getActionButton());

      await waitFor(() => {
        expect(state.connect).toHaveBeenCalledTimes(1);
      });
      expect(state.disconnect).not.toHaveBeenCalled();
    });

    it("does not render the account switcher while disconnected", () => {
      mockWallet({ connected: false, accounts: [ACCOUNT_A] });

      render(<WalletConnectButton />);

      // AccountSwitcher renders its own trigger button; only the connect
      // button should be present.
      expect(screen.getAllByRole("button")).toHaveLength(1);
    });
  });

  describe("connected state", () => {
    it("renders the wallet name in the disconnect label", () => {
      mockWallet({
        connected: true,
        walletName: "Freighter",
        accounts: [ACCOUNT_A],
        publicKey: ACCOUNT_A,
      });

      render(<WalletConnectButton />);

      expect(
        screen.getByRole("button", { name: /disconnect freighter/i }),
      ).toBeInTheDocument();
    });

    it("calls disconnect when the button is clicked", async () => {
      const state = mockWallet({
        connected: true,
        walletName: "Freighter",
        accounts: [ACCOUNT_A],
        publicKey: ACCOUNT_A,
      });

      render(<WalletConnectButton />);
      fireEvent.click(getActionButton());

      await waitFor(() => {
        expect(state.disconnect).toHaveBeenCalledTimes(1);
      });
      expect(state.connect).not.toHaveBeenCalled();
    });

    it("renders the account switcher when connected with accounts", () => {
      mockWallet({
        connected: true,
        walletName: "Freighter",
        accounts: [ACCOUNT_A, ACCOUNT_B],
        publicKey: ACCOUNT_A,
      });

      render(<WalletConnectButton />);

      // The switcher adds a second button beside the disconnect button.
      expect(screen.getAllByRole("button").length).toBeGreaterThan(1);
    });

    it("does not render the account switcher when there are no accounts", () => {
      mockWallet({
        connected: true,
        walletName: "Freighter",
        accounts: [],
        publicKey: ACCOUNT_A,
      });

      render(<WalletConnectButton />);

      expect(screen.getAllByRole("button")).toHaveLength(1);
    });
  });

  describe("in-flight state", () => {
    it('shows "Connecting..." and disables the button while connecting', async () => {
      let release!: () => void;
      const connect = jest.fn<() => Promise<void>>().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      mockWallet({ connected: false, connect });

      render(<WalletConnectButton />);
      fireEvent.click(getActionButton());

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /connecting/i }),
        ).toBeDisabled();
      });

      release();
      await waitFor(() => {
        expect(getActionButton()).not.toBeDisabled();
      });
    });

    it('shows "Disconnecting..." while disconnecting', async () => {
      let release!: () => void;
      const disconnect = jest.fn<() => Promise<void>>().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      mockWallet({
        connected: true,
        walletName: "Freighter",
        accounts: [ACCOUNT_A],
        publicKey: ACCOUNT_A,
        disconnect,
      });

      render(<WalletConnectButton />);
      fireEvent.click(getActionButton());

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /disconnecting/i }),
        ).toBeDisabled();
      });

      release();
      await waitFor(() => {
        expect(getActionButton()).not.toBeDisabled();
      });
    });

    it("ignores extra clicks while an action is in flight", async () => {
      let release!: () => void;
      const connect = jest.fn<() => Promise<void>>().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      mockWallet({ connected: false, connect });

      render(<WalletConnectButton />);
      const button = getActionButton();
      fireEvent.click(button);
      fireEvent.click(button);
      fireEvent.click(button);

      await waitFor(() => {
        expect(button).toBeDisabled();
      });
      expect(connect).toHaveBeenCalledTimes(1);

      release();
      await waitFor(() => {
        expect(getActionButton()).not.toBeDisabled();
      });
    });
  });

  describe("failure handling", () => {
    it("re-enables the button when connect rejects", async () => {
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const connect = jest
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error("User rejected"));
      mockWallet({ connected: false, connect });

      render(<WalletConnectButton />);
      fireEvent.click(getActionButton());

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /connect wallet/i }),
        ).not.toBeDisabled();
      });
      expect(consoleError).toHaveBeenCalled();
    });

    it("re-enables the button when disconnect rejects", async () => {
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const disconnect = jest
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error("Disconnect failed"));
      mockWallet({
        connected: true,
        walletName: "Freighter",
        accounts: [ACCOUNT_A],
        publicKey: ACCOUNT_A,
        disconnect,
      });

      render(<WalletConnectButton />);
      fireEvent.click(getActionButton());

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /disconnect freighter/i }),
        ).not.toBeDisabled();
      });
      expect(consoleError).toHaveBeenCalled();
    });
  });

  describe("theme", () => {
    it("applies light theme styling by default", () => {
      mockWallet({ connected: false });

      render(<WalletConnectButton />);

      expect(getActionButton()).toHaveClass("bg-black", "text-white");
    });

    it("applies dark theme styling when theme is dark", () => {
      mockWallet({ connected: false });

      render(<WalletConnectButton theme="dark" />);

      expect(getActionButton()).toHaveClass("bg-white", "text-black");
    });
  });
});
