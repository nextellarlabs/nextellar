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
import { assertValidNetworkUrl } from "../../src/templates/default/src/config/networks";

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

interface NetworkConfigShape {
  name: string;
  horizonUrl: string;
  sorobanUrl: string;
  passphrase: string;
  isCustom?: boolean;
}

interface WalletConfigShape {
  activeNetworkKey: string;
  switchNetwork?: (key: string) => void;
  networks?: Record<string, NetworkConfigShape>;
  addCustomNetwork?: (
    key: string,
    config: Omit<NetworkConfigShape, "isCustom">,
  ) => void;
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

  describe("custom network entry (#1107)", () => {
    it("does not offer the add-network option when the provider lacks addCustomNetwork", () => {
      setupProvider({ activeNetworkKey: "testnet", switchNetwork: jest.fn() });

      render(<NetworkSwitcher />);

      const values = Array.from(getSelect().options).map((o) => o.value);
      expect(values).not.toContain("__add_custom_network__");
    });

    it("shows the add-network form when '+ Add custom network...' is selected", () => {
      setupProvider({
        activeNetworkKey: "testnet",
        switchNetwork: jest.fn(),
        addCustomNetwork: jest.fn(),
      });

      render(<NetworkSwitcher />);
      fireEvent.change(getSelect(), {
        target: { value: "__add_custom_network__" },
      });

      expect(
        screen.getByRole("form", { name: "Add custom network" }),
      ).toBeInTheDocument();
    });

    it("calls addCustomNetwork with validated field values and switches to it on submit", () => {
      const switchNetwork = jest.fn();
      const addCustomNetwork = jest.fn();
      setupProvider({
        activeNetworkKey: "testnet",
        switchNetwork,
        addCustomNetwork,
      });

      render(<NetworkSwitcher />);
      fireEvent.change(getSelect(), {
        target: { value: "__add_custom_network__" },
      });

      fireEvent.change(screen.getByLabelText("Network key"), {
        target: { value: "futurenet" },
      });
      fireEvent.change(screen.getByLabelText("Display name"), {
        target: { value: "Futurenet" },
      });
      fireEvent.change(screen.getByLabelText("Horizon URL"), {
        target: { value: "https://horizon-futurenet.stellar.org" },
      });
      fireEvent.change(screen.getByLabelText("Soroban RPC URL"), {
        target: { value: "https://rpc-futurenet.stellar.org" },
      });
      fireEvent.change(screen.getByLabelText("Network passphrase"), {
        target: { value: "Test SDF Future Network ; October 2022" },
      });

      fireEvent.click(screen.getByRole("button", { name: "Add network" }));

      expect(addCustomNetwork).toHaveBeenCalledWith("futurenet", {
        name: "Futurenet",
        horizonUrl: "https://horizon-futurenet.stellar.org",
        sorobanUrl: "https://rpc-futurenet.stellar.org",
        passphrase: "Test SDF Future Network ; October 2022",
      });
      expect(switchNetwork).toHaveBeenCalledWith("futurenet");
    });

    it("shows an error and does not switch when addCustomNetwork rejects the input", () => {
      const switchNetwork = jest.fn();
      const addCustomNetwork = jest.fn(() => {
        throw new Error('Invalid Horizon URL: "not-a-url" is not a valid URL.');
      });
      setupProvider({
        activeNetworkKey: "testnet",
        switchNetwork,
        addCustomNetwork,
      });

      render(<NetworkSwitcher />);
      fireEvent.change(getSelect(), {
        target: { value: "__add_custom_network__" },
      });

      fireEvent.change(screen.getByLabelText("Network key"), {
        target: { value: "futurenet" },
      });
      fireEvent.change(screen.getByLabelText("Horizon URL"), {
        target: { value: "not-a-url" },
      });
      fireEvent.change(screen.getByLabelText("Soroban RPC URL"), {
        target: { value: "https://rpc-futurenet.stellar.org" },
      });
      fireEvent.change(screen.getByLabelText("Network passphrase"), {
        target: { value: "Test SDF Future Network ; October 2022" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Add network" }));

      expect(screen.getByRole("alert")).toHaveTextContent(
        'Invalid Horizon URL: "not-a-url" is not a valid URL.',
      );
      expect(switchNetwork).not.toHaveBeenCalled();
    });

    it("rejects a non-http(s) Soroban RPC URL entered in the form and does not switch", () => {
      const switchNetwork = jest.fn();
      // Wire the real shared validator, as the WalletProvider does.
      const addCustomNetwork = jest.fn(
        (_key: string, cfg: Omit<NetworkConfigShape, "isCustom">) => {
          assertValidNetworkUrl(cfg.horizonUrl, "Horizon URL");
          assertValidNetworkUrl(cfg.sorobanUrl, "Soroban RPC URL");
        },
      );
      setupProvider({
        activeNetworkKey: "testnet",
        switchNetwork,
        addCustomNetwork,
      });

      render(<NetworkSwitcher />);
      fireEvent.change(getSelect(), {
        target: { value: "__add_custom_network__" },
      });

      fireEvent.change(screen.getByLabelText("Network key"), {
        target: { value: "futurenet" },
      });
      fireEvent.change(screen.getByLabelText("Horizon URL"), {
        target: { value: "https://horizon-futurenet.stellar.org" },
      });
      fireEvent.change(screen.getByLabelText("Soroban RPC URL"), {
        target: { value: "ftp://rpc-futurenet.stellar.org" },
      });
      fireEvent.change(screen.getByLabelText("Network passphrase"), {
        target: { value: "Test SDF Future Network ; October 2022" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Add network" }));

      expect(screen.getByRole("alert")).toHaveTextContent(
        'Invalid Soroban RPC URL: "ftp://rpc-futurenet.stellar.org" must use http or https.',
      );
      expect(switchNetwork).not.toHaveBeenCalled();
    });

    it("renders a custom network already in the networks map as a selectable option", () => {
      setupProvider({
        activeNetworkKey: "futurenet",
        switchNetwork: jest.fn(),
        addCustomNetwork: jest.fn(),
        networks: {
          testnet: {
            name: "Testnet",
            horizonUrl: "https://horizon-testnet.stellar.org",
            sorobanUrl: "https://soroban-testnet.stellar.org",
            passphrase: "Test SDF Network ; September 2015",
          },
          mainnet: {
            name: "Mainnet",
            horizonUrl: "https://horizon.stellar.org",
            sorobanUrl: "https://soroban.stellar.org",
            passphrase: "Public Global Stellar Network ; September 2015",
          },
          futurenet: {
            name: "Futurenet",
            horizonUrl: "https://horizon-futurenet.stellar.org",
            sorobanUrl: "https://rpc-futurenet.stellar.org",
            passphrase: "Test SDF Future Network ; October 2022",
            isCustom: true,
          },
        },
      });

      render(<NetworkSwitcher />);

      const values = Array.from(getSelect().options).map((o) => o.value);
      expect(values).toEqual([
        "testnet",
        "mainnet",
        "futurenet",
        "__add_custom_network__",
      ]);
      expect(getSelect().value).toBe("futurenet");
    });

    it("closes the add-network form without submitting when cancelled", () => {
      const addCustomNetwork = jest.fn();
      setupProvider({
        activeNetworkKey: "testnet",
        switchNetwork: jest.fn(),
        addCustomNetwork,
      });

      render(<NetworkSwitcher />);
      fireEvent.change(getSelect(), {
        target: { value: "__add_custom_network__" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Cancel adding custom network" }),
      );

      expect(
        screen.queryByRole("form", { name: "Add custom network" }),
      ).not.toBeInTheDocument();
      expect(addCustomNetwork).not.toHaveBeenCalled();
    });
  });

  describe("custom RPC URL validation (#1134, matches doctor #831)", () => {
    it.each([
      "http://localhost:8000",
      "https://soroban-testnet.stellar.org",
    ])("accepts %s", (url) => {
      expect(() => assertValidNetworkUrl(url, "Soroban RPC URL")).not.toThrow();
    });

    it.each(["ftp://rpc.example.org", "file:///etc/passwd", "javascript:alert(1)"])(
      "rejects non-http(s) URL %s",
      (url) => {
        expect(() => assertValidNetworkUrl(url, "Soroban RPC URL")).toThrow(
          /must use http or https/,
        );
      },
    );

    it.each(["not-a-url", "", "rpc.example.org"])(
      "rejects unparseable URL %j",
      (url) => {
        expect(() => assertValidNetworkUrl(url, "Soroban RPC URL")).toThrow(
          /is not a valid URL/,
        );
      },
    );
  });
});
