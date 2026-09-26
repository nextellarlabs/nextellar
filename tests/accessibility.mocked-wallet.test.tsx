/**
 * @jest-environment jsdom
 *
 * Split out of accessibility.test.tsx (#946): these components' tests need
 * `useWallet()`/`useStellarBalances()` as real `jest.fn()`s with per-test
 * `mockReturnValue` control, via `jest.unstable_mockModule`. That only works
 * if nothing in this file's module graph statically imports the real
 * `src/mocks/wallet-contexts-mock` before the mock is registered — which is
 * exactly what `./helpers` does for its Context-Provider-based
 * `render(el, { wallet })` pattern (see accessibility.test.tsx). Keeping
 * these two testing styles in separate files avoids that conflict rather
 * than working around it.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";
import {
  describe,
  expect,
  it,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";

expect.extend(toHaveNoViolations);

// '../contexts' is redirected by jest.config's moduleNameMapper to
// src/mocks/wallet-contexts-mock.ts for every template (they all import the
// wallet context via that same relative specifier). Overriding it here lets
// each test drive useWallet() with real return values instead of the shared
// mock's "throw if used" defaults.
jest.unstable_mockModule("../src/mocks/wallet-contexts-mock", () => ({
  useWallet: jest.fn(),
  useWalletConfig: jest.fn(() => undefined),
  WalletProvider: jest.fn(
    ({ children }: { children: React.ReactNode }) => children,
  ),
}));

jest.unstable_mockModule(
  "../src/templates/default/src/hooks/useStellarBalances",
  () => ({
    useStellarBalances: jest.fn(),
  }),
);

// Dynamic imports (must come after unstable_mockModule).
const [
  { useWallet, useWalletConfig },
  { useStellarBalances },
  { default: NetworkSwitcher },
  { default: BalanceDisplay },
] = await Promise.all([
  import("../src/mocks/wallet-contexts-mock"),
  import("../src/templates/default/src/hooks/useStellarBalances"),
  import("../src/templates/default/src/components/NetworkSwitcher"),
  import("../src/templates/default/src/components/BalanceDisplay"),
]);

describe("accessibility (#946) — mocked wallet hooks", () => {
  describe("NetworkSwitcher", () => {
    const mockUseWallet = useWallet as jest.Mock;
    const mockUseWalletConfig = useWalletConfig as jest.Mock;

    beforeEach(() => {
      mockUseWallet.mockReturnValue({ connected: false });
      mockUseWalletConfig.mockReturnValue({
        activeNetworkKey: "testnet",
        switchNetwork: jest.fn(),
        horizonUrl: "https://horizon-testnet.stellar.org",
      });
    });

    afterEach(() => {
      mockUseWallet.mockReset();
      mockUseWalletConfig.mockReset();
    });

    it("labels the native listbox control for screen readers and keyboard users", () => {
      render(React.createElement(NetworkSwitcher));
      const select = screen.getByRole("combobox", { name: "Network" });
      expect(select).toHaveAttribute("aria-labelledby");
      expect(
        document.getElementById(select.getAttribute("aria-labelledby")!),
      ).toHaveTextContent("Network");
    });
  });

  describe("BalanceDisplay", () => {
    const mockUseWallet = useWallet as jest.Mock;
    const mockUseStellarBalances = useStellarBalances as jest.Mock;

    afterEach(() => {
      mockUseWallet.mockReset();
      mockUseStellarBalances.mockReset();
    });

    it("announces the balance loading skeleton", () => {
      mockUseWallet.mockReturnValue({ connected: true, publicKey: "GABC" });
      mockUseStellarBalances.mockReturnValue({
        balances: [],
        loading: true,
        error: null,
        refresh: jest.fn(),
      });

      render(React.createElement(BalanceDisplay));
      expect(
        screen.getByRole("status", { name: "Loading balances" }),
      ).toBeInTheDocument();
    });

    it("renders the native balance as the headline figure", () => {
      mockUseWallet.mockReturnValue({ connected: true, publicKey: "GABC" });
      mockUseStellarBalances.mockReturnValue({
        balances: [{ asset_type: "native", balance: "42.0000000" }],
        loading: false,
        error: null,
        refresh: jest.fn(),
      });

      render(React.createElement(BalanceDisplay));
      expect(
        screen.getByRole("heading", { name: "Balances" }),
      ).toBeInTheDocument();
      // formatBalance() trims trailing zeros via toLocaleString (see
      // BalanceDisplay.tsx) — the raw "42.0000000" input renders as "42.00".
      expect(screen.getByText("42.00")).toBeInTheDocument();
      expect(screen.getByText("XLM")).toBeInTheDocument();
    });

    it("renders credit assets as a semantic list", () => {
      mockUseWallet.mockReturnValue({ connected: true, publicKey: "GABC" });
      mockUseStellarBalances.mockReturnValue({
        balances: [
          { asset_type: "native", balance: "100.0000000" },
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer:
              "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
            balance: "25.5000000",
          },
        ],
        loading: false,
        error: null,
        refresh: jest.fn(),
      });

      render(React.createElement(BalanceDisplay));
      expect(screen.getByRole("list")).toBeInTheDocument();
      expect(screen.getByText("USDC")).toBeInTheDocument();
      expect(screen.getByText("25.50")).toBeInTheDocument();
    });
  });
});
