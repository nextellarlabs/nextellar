/**
 * @jest-environment jsdom
 *
 * NetworkSwitcher Component Tests
 *
 * Covers:
 * - Selecting a network calls switchNetwork with the selected key
 * - Renders null when the provider does not expose switchNetwork
 * - The connected-wallet confirm() gate around a network switch
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
// NetworkSwitcher imports from '../contexts/WalletProvider', which jest.config.mjs
// maps to src/mocks/wallet-contexts-mock. Mock that mapped module so both
// useWalletConfig and useWallet are controllable per test.
jest.unstable_mockModule("../../src/mocks/wallet-contexts-mock", () => ({
  useWalletConfig: jest.fn(),
  useWallet: jest.fn(),
  WalletProvider: jest.fn(
    ({ children }: { children: React.ReactNode }) => children,
  ),
}));

// ── Dynamic imports (must come after unstable_mockModule) ─────────────────────
const [{ default: NetworkSwitcher }, { useWalletConfig, useWallet }] =
  await Promise.all([
    import("../../src/templates/default/src/components/NetworkSwitcher"),
    import("../../src/mocks/wallet-contexts-mock"),
  ]);

// ── Types & helpers ───────────────────────────────────────────────────────────

interface WalletConfigShape {
  activeNetworkKey: string;
  switchNetwork?: (key: string) => void;
}

const mockUseWalletConfig = useWalletConfig as unknown as jest.Mock<
  () => WalletConfigShape | undefined
>;
const mockUseWallet = useWallet as unknown as jest.Mock<
  () => { connected: boolean } | undefined
>;

/** Configures the provider mocks for a single test. */
function setupProvider(
  config: WalletConfigShape | undefined,
  wallet: { connected: boolean } | undefined = { connected: false },
) {
  mockUseWalletConfig.mockReturnValue(config);
  mockUseWallet.mockReturnValue(wallet);
}

/** The network <select>, which is the component's only interactive control. */
function getSelect() {
  return screen.getByLabelText("Network") as HTMLSelectElement;
}

describe("NetworkSwitcher", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("switch behavior", () => {
    it("calls switchNetwork with the selected key when a new network is chosen", async () => {
      const switchNetwork = jest.fn();
      setupProvider({ activeNetworkKey: "testnet", switchNetwork });

      render(<NetworkSwitcher />);

      fireEvent.change(getSelect(), { target: { value: "mainnet" } });

      await waitFor(() => {
        expect(switchNetwork).toHaveBeenCalledWith("mainnet");
      });
      expect(switchNetwork).toHaveBeenCalledTimes(1);
    });

    it('calls switchNetwork with "testnet" when switching back from mainnet', async () => {
      const switchNetwork = jest.fn();
      setupProvider({ activeNetworkKey: "mainnet", switchNetwork });

      render(<NetworkSwitcher />);

      fireEvent.change(getSelect(), { target: { value: "testnet" } });

      await waitFor(() => {
        expect(switchNetwork).toHaveBeenCalledWith("testnet");
      });
    });

    it("does not call switchNetwork when the selected network is already active", () => {
      const switchNetwork = jest.fn();
      setupProvider({ activeNetworkKey: "testnet", switchNetwork });

      render(<NetworkSwitcher />);

      fireEvent.change(getSelect(), { target: { value: "testnet" } });

      expect(switchNetwork).not.toHaveBeenCalled();
    });

    it("reflects the active network key as the select value", () => {
      setupProvider({ activeNetworkKey: "mainnet", switchNetwork: jest.fn() });

      render(<NetworkSwitcher />);

      expect(getSelect().value).toBe("mainnet");
    });

    it("offers both testnet and mainnet options", () => {
      setupProvider({ activeNetworkKey: "testnet", switchNetwork: jest.fn() });

      render(<NetworkSwitcher />);

      const values = Array.from(getSelect().options).map((o) => o.value);
      expect(values).toEqual(["testnet", "mainnet"]);
    });
  });

  describe("null rendering", () => {
    it("renders null when the provider lacks switchNetwork", () => {
      setupProvider({ activeNetworkKey: "testnet" });

      const { container } = render(<NetworkSwitcher />);

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByLabelText("Network")).not.toBeInTheDocument();
    });

    it("renders null when there is no wallet config at all", () => {
      setupProvider(undefined);

      const { container } = render(<NetworkSwitcher />);

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe("connected-wallet confirmation", () => {
    it("switches without confirming when no wallet is connected", () => {
      const switchNetwork = jest.fn();
      const confirmSpy = jest
        .spyOn(window, "confirm")
        .mockReturnValue(true) as unknown as jest.Mock;
      setupProvider(
        { activeNetworkKey: "testnet", switchNetwork },
        { connected: false },
      );

      render(<NetworkSwitcher />);
      fireEvent.change(getSelect(), { target: { value: "mainnet" } });

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(switchNetwork).toHaveBeenCalledWith("mainnet");
    });

    it("switches when a connected wallet holder accepts the confirmation", () => {
      const switchNetwork = jest.fn();
      jest.spyOn(window, "confirm").mockReturnValue(true);
      setupProvider(
        { activeNetworkKey: "testnet", switchNetwork },
        { connected: true },
      );

      render(<NetworkSwitcher />);
      fireEvent.change(getSelect(), { target: { value: "mainnet" } });

      expect(window.confirm).toHaveBeenCalled();
      expect(switchNetwork).toHaveBeenCalledWith("mainnet");
    });

    it("does not switch when a connected wallet holder cancels the confirmation", () => {
      const switchNetwork = jest.fn();
      jest.spyOn(window, "confirm").mockReturnValue(false);
      setupProvider(
        { activeNetworkKey: "testnet", switchNetwork },
        { connected: true },
      );

      render(<NetworkSwitcher />);
      fireEvent.change(getSelect(), { target: { value: "mainnet" } });

      expect(window.confirm).toHaveBeenCalled();
      expect(switchNetwork).not.toHaveBeenCalled();
    });
  });
});
