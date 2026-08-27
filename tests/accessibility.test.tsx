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
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { jest, describe, it, expect, afterEach, beforeEach } from '@jest/globals';
import React from 'react';

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

// Dynamic imports (must come after unstable_mockModule).
const [
  { useWallet },
  { default: ErrorBoundary },
  { default: ErrorBoundaryJs },
  { default: WalletConnectButton },
  { default: AccountSwitcher },
] = await Promise.all([
  import('../src/mocks/wallet-contexts-mock'),
  import('../src/templates/default/src/components/ErrorBoundary'),
  import('../src/templates/js-template/src/components/ErrorBoundary.jsx'),
  import('../src/templates/default/src/components/WalletConnectButton'),
  import('../src/templates/default/src/components/AccountSwitcher'),
]);

function Boom(): never {
  throw new Error('boom');
}

describe('accessibility (#946)', () => {
  describe('ErrorBoundary fallback', () => {
    it('has no axe violations', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { container } = render(
        React.createElement(ErrorBoundary, null, React.createElement(Boom)),
      );

      expect(await axe(container)).toHaveNoViolations();
      consoleErrorSpy.mockRestore();
    });

    it('has no axe violations (JS template variant)', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { container } = render(
        React.createElement(ErrorBoundaryJs, null, React.createElement(Boom)),
      );

      expect(await axe(container)).toHaveNoViolations();
      consoleErrorSpy.mockRestore();
    });

    it('exposes the error details disclosure as an ARIA toggle', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      render(React.createElement(ErrorBoundary, null, React.createElement(Boom)));

      const toggle = screen.getByRole('button', { name: 'Show Details' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).toHaveAttribute('aria-controls', 'error-boundary-details');

      fireEvent.click(toggle);

      expect(screen.getByRole('button', { name: 'Hide Details' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      expect(document.getElementById('error-boundary-details')).toBeInTheDocument();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('WalletConnectButton', () => {
    const mockUseWallet = useWallet as jest.Mock;

    afterEach(() => {
      mockUseWallet.mockReset();
    });

    it('has no axe violations when disconnected', async () => {
      mockUseWallet.mockReturnValue({
        connected: false,
        connect: jest.fn(),
        disconnect: jest.fn(),
        walletName: undefined,
        accounts: [],
      });

      const { container } = render(React.createElement(WalletConnectButton));
      expect(await axe(container)).toHaveNoViolations();
    });

    it('has no axe violations when connected', async () => {
      mockUseWallet.mockReturnValue({
        connected: true,
        connect: jest.fn(),
        disconnect: jest.fn(),
        walletName: 'Freighter',
        accounts: [],
      });

      const { container } = render(React.createElement(WalletConnectButton));
      expect(await axe(container)).toHaveNoViolations();
    });

    it('hides the decorative wallet icon from assistive tech', () => {
      mockUseWallet.mockReturnValue({
        connected: false,
        connect: jest.fn(),
        disconnect: jest.fn(),
        walletName: undefined,
        accounts: [],
      });

      const { container } = render(React.createElement(WalletConnectButton));
      expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('AccountSwitcher', () => {
    const mockUseWallet = useWallet as jest.Mock;

    const accounts = [
      { address: 'GABC1', displayName: 'Main Account' },
      { address: 'GABC2', displayName: 'Second Account' },
    ];

    beforeEach(() => {
      mockUseWallet.mockReturnValue({
        connected: true,
        accounts,
        currentAccountIndex: 0,
        switchAccount: jest.fn(),
        publicKey: accounts[0].address,
      });
    });

    afterEach(() => {
      mockUseWallet.mockReset();
    });

    it('has no axe violations closed', async () => {
      const { container } = render(React.createElement(AccountSwitcher));
      expect(await axe(container)).toHaveNoViolations();
    });

    it('has no axe violations open', async () => {
      const { container } = render(React.createElement(AccountSwitcher));
      fireEvent.click(screen.getByRole('button', { name: /Main Account/ }));
      expect(await axe(container)).toHaveNoViolations();
    });

    it('exposes the trigger as a menu button reflecting open state', () => {
      render(React.createElement(AccountSwitcher));
      const trigger = screen.getByRole('button', { name: /Main Account/ });

      expect(trigger).toHaveAttribute('aria-haspopup', 'true');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('marks the active account with aria-current', () => {
      render(React.createElement(AccountSwitcher));
      fireEvent.click(screen.getByRole('button', { name: /Main Account/ }));

      const items = screen.getAllByRole('menuitem');
      expect(items[0]).toHaveAttribute('aria-current', 'true');
      expect(items[1]).not.toHaveAttribute('aria-current');
    });

    it('closes on Escape', () => {
      render(React.createElement(AccountSwitcher));
      fireEvent.click(screen.getByRole('button', { name: /Main Account/ }));
      expect(screen.getByRole('menu')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });
});
