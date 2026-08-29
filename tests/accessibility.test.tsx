/**
 * @jest-environment jsdom
 *
 * Automated WCAG 2.1 AA regression coverage (#946) for template components
 * that render without heavy external dependencies. Runs axe-core (via
 * jest-axe) against real, rendered markup, plus targeted assertions for the
 * ARIA/keyboard behaviour axe can't check on its own (focus handling, live
 * regions carrying the right semantics, etc.).
 *
 * See docs/accessibility-audit.md for the full audit, including findings
 * that could only be verified manually or need a real browser.
 */
import React from "react";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, it } from "@jest/globals";
import ErrorBoundary from "../src/templates/default/src/components/ErrorBoundary";
import ErrorBoundaryJs from "../src/templates/js-template/src/components/ErrorBoundary.jsx";
import WalletConnectButton from "../src/templates/default/src/components/WalletConnectButton";
import AccountSwitcher from "../src/templates/default/src/components/AccountSwitcher";
import {
  ACCOUNT_MAIN,
  ACCOUNT_SECOND,
  connectedWallet,
  disconnectedWallet,
  fireEvent,
  render,
  screen,
  silenceConsole,
} from "./helpers";

expect.extend(toHaveNoViolations);

// '../contexts' is redirected by jest.config's moduleNameMapper to
// src/mocks/wallet-contexts-mock.ts for every template (they all import the
// wallet context via that same relative specifier). Overriding it here lets
// each test drive useWallet() with real return values instead of the shared
// mock's "throw if used" defaults.
jest.unstable_mockModule('../src/mocks/wallet-contexts-mock', () => ({
  useWallet: jest.fn(),
  useWalletConfig: jest.fn(() => undefined),
  WalletProvider: jest.fn(({ children }: { children: React.ReactNode }) => children),
}));

jest.unstable_mockModule('../src/templates/default/src/hooks/useStellarBalances', () => ({
  useStellarBalances: jest.fn(),
}));

// Dynamic imports (must come after unstable_mockModule).
const [
  { useWallet, useWalletConfig },
  { useStellarBalances },
  { default: ErrorBoundary },
  { default: ErrorBoundaryJs },
  { default: WalletConnectButton },
  { default: AccountSwitcher },
  { default: BalanceDisplay },
  { default: NetworkSwitcher },
] = await Promise.all([
  import('../src/mocks/wallet-contexts-mock'),
  import('../src/templates/default/src/hooks/useStellarBalances'),
  import('../src/templates/default/src/components/ErrorBoundary'),
  import('../src/templates/js-template/src/components/ErrorBoundary.jsx'),
  import('../src/templates/default/src/components/WalletConnectButton'),
  import('../src/templates/default/src/components/AccountSwitcher'),
  import('../src/templates/default/src/components/BalanceDisplay'),
  import('../src/templates/default/src/components/NetworkSwitcher'),
]);

function Boom(): never {
  throw new Error("boom");
}

const twoAccounts = connectedWallet({
  accounts: [ACCOUNT_MAIN, ACCOUNT_SECOND],
  currentAccountIndex: 0,
  publicKey: ACCOUNT_MAIN.address,
});

describe("accessibility (#946)", () => {
  describe("ErrorBoundary fallback", () => {
    it("has no axe violations", async () => {
      const restoreConsole = silenceConsole();
      const { container } = render(
        React.createElement(ErrorBoundary, null, React.createElement(Boom)),
      );

      expect(await axe(container)).toHaveNoViolations();
      restoreConsole();
    });

    it("has no axe violations (JS template variant)", async () => {
      const restoreConsole = silenceConsole();
      const { container } = render(
        React.createElement(ErrorBoundaryJs, null, React.createElement(Boom)),
      );

      expect(await axe(container)).toHaveNoViolations();
      restoreConsole();
    });

    it("exposes the error details disclosure as an ARIA toggle", () => {
      const restoreConsole = silenceConsole();
      render(
        React.createElement(ErrorBoundary, null, React.createElement(Boom)),
      );

      const toggle = screen.getByRole("button", { name: "Show Details" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveAttribute("aria-controls", "error-boundary-details");

      fireEvent.click(toggle);

      expect(
        screen.getByRole("button", { name: "Hide Details" }),
      ).toHaveAttribute("aria-expanded", "true");
      expect(
        document.getElementById("error-boundary-details"),
      ).toBeInTheDocument();

      restoreConsole();
    });
  });

  describe("WalletConnectButton", () => {
    it("has no axe violations when disconnected", async () => {
      const { container } = render(React.createElement(WalletConnectButton), {
        wallet: disconnectedWallet(),
      });
      expect(await axe(container)).toHaveNoViolations();
    });

    it("has no axe violations when connected", async () => {
      const { container } = render(React.createElement(WalletConnectButton), {
        wallet: connectedWallet(),
      });
      expect(await axe(container)).toHaveNoViolations();
    });

    it("hides the decorative wallet icon from assistive tech", () => {
      const { container } = render(React.createElement(WalletConnectButton), {
        wallet: disconnectedWallet(),
      });
      expect(container.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    });

    it('has an action-specific accessible name and visible focus ring classes', () => {
      mockUseWallet.mockReturnValue({
        connected: false,
        connect: jest.fn(),
        disconnect: jest.fn(),
        walletName: undefined,
        accounts: [],
      });

      render(React.createElement(WalletConnectButton));
      const button = screen.getByRole('button', { name: 'Connect Stellar wallet' });
      expect(button).toHaveAttribute('type', 'button');
      expect(button.className).toContain('focus-visible:ring-2');
    });
  });

  describe('NetworkSwitcher', () => {
    const mockUseWallet = useWallet as jest.Mock;
    const mockUseWalletConfig = useWalletConfig as jest.Mock;

    beforeEach(() => {
      mockUseWallet.mockReturnValue({ connected: false });
      mockUseWalletConfig.mockReturnValue({
        activeNetworkKey: 'testnet',
        switchNetwork: jest.fn(),
        horizonUrl: 'https://horizon-testnet.stellar.org',
      });
    });

    afterEach(() => {
      mockUseWallet.mockReset();
      mockUseWalletConfig.mockReset();
    });

    it('labels the native listbox control for screen readers and keyboard users', () => {
      render(React.createElement(NetworkSwitcher));
      const select = screen.getByRole('combobox', { name: 'Network' });
      expect(select).toHaveAttribute('aria-labelledby');
      expect(document.getElementById(select.getAttribute('aria-labelledby')!)).toHaveTextContent('Network');
    });
  });

  describe('BalanceDisplay', () => {
    const mockUseWallet = useWallet as jest.Mock;
    const mockUseStellarBalances = useStellarBalances as jest.Mock;

    afterEach(() => {
      mockUseWallet.mockReset();
      mockUseStellarBalances.mockReset();
    });

    it('announces the balance loading skeleton', () => {
      mockUseWallet.mockReturnValue({ connected: true, publicKey: 'GABC' });
      mockUseStellarBalances.mockReturnValue({
        balances: [],
        loading: true,
        error: null,
        refresh: jest.fn(),
      });

      render(React.createElement(BalanceDisplay));
      expect(screen.getByRole('status', { name: 'Loading account balances' })).toBeInTheDocument();
    });

    it('renders account balances as a labelled list', () => {
      mockUseWallet.mockReturnValue({ connected: true, publicKey: 'GABC' });
      mockUseStellarBalances.mockReturnValue({
        balances: [{ asset_type: 'native', balance: '42.0000000' }],
        loading: false,
        error: null,
        refresh: jest.fn(),
      });

      render(React.createElement(BalanceDisplay));
      expect(screen.getByRole('heading', { name: 'Balances' })).toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Account balances' })).toBeInTheDocument();
      expect(screen.getByText('42.0000000')).toBeInTheDocument();
    });
  });

  describe("AccountSwitcher", () => {
    it("has no axe violations closed", async () => {
      const { container } = render(React.createElement(AccountSwitcher), {
        wallet: twoAccounts,
      });
      expect(await axe(container)).toHaveNoViolations();
    });

    it("has no axe violations open", async () => {
      const { container } = render(React.createElement(AccountSwitcher), {
        wallet: twoAccounts,
      });
      fireEvent.click(screen.getByRole("button", { name: /Main Account/ }));
      expect(await axe(container)).toHaveNoViolations();
    });

    it("exposes the trigger as a menu button reflecting open state", () => {
      render(React.createElement(AccountSwitcher), { wallet: twoAccounts });
      const trigger = screen.getByRole("button", { name: /Main Account/ });

      expect(trigger).toHaveAttribute("aria-haspopup", "true");
      expect(trigger).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    it("marks the active account with aria-current", () => {
      render(React.createElement(AccountSwitcher), { wallet: twoAccounts });
      fireEvent.click(screen.getByRole("button", { name: /Main Account/ }));

      const items = screen.getAllByRole("menuitem");
      expect(items[0]).toHaveAttribute("aria-current", "true");
      expect(items[1]).not.toHaveAttribute("aria-current");
    });

    it("closes on Escape", () => {
      render(React.createElement(AccountSwitcher), { wallet: twoAccounts });
      fireEvent.click(screen.getByRole("button", { name: /Main Account/ }));
      expect(screen.getByRole("menu")).toBeInTheDocument();

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });
});
