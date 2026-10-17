/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AccountSwitcher from '../components/AccountSwitcher';
import { WalletContext, WalletAccount } from '../contexts/WalletProvider';
import { ReactNode } from 'react';

describe('AccountSwitcher Component', () => {
  const mockSwitchAccount = jest.fn();

  const mockWalletState = {
    connected: true,
    publicKey: 'GACCOUNT0000000001',
    walletName: 'Freighter',
    balances: [],
    accounts: [
      {
        address: 'GACCOUNT0000000001',
        displayName: 'Freighter - GACCOUNT0000000001',
      },
      {
        address: 'GACCOUNT0000000002',
        displayName: 'Freighter - GACCOUNT0000000002',
      },
    ] as WalletAccount[],
    currentAccountIndex: 0,
    connect: jest.fn(),
    disconnect: jest.fn(),
    refreshBalances: jest.fn(),
    switchAccount: mockSwitchAccount,
  };

  const renderWithWallet = (component: ReactNode) => {
    return render(
      <WalletContext.Provider value={mockWalletState}>
        {component}
      </WalletContext.Provider>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Visibility', () => {
    it('should not render when not connected', () => {
      const disconnectedState = { ...mockWalletState, connected: false };
      render(
        <WalletContext.Provider value={disconnectedState}>
          <AccountSwitcher />
        </WalletContext.Provider>
      );

      const button = screen.queryByRole('button');
      expect(button).not.toBeInTheDocument();
    });

    it('should not render when no accounts', () => {
      const noAccountsState = { ...mockWalletState, accounts: [] };
      render(
        <WalletContext.Provider value={noAccountsState}>
          <AccountSwitcher />
        </WalletContext.Provider>
      );

      const button = screen.queryByRole('button');
      expect(button).not.toBeInTheDocument();
    });

    it('should render when connected with accounts', () => {
      renderWithWallet(<AccountSwitcher />);

      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
    });
  });

  describe('Display', () => {
    it('should display current account name', () => {
      renderWithWallet(<AccountSwitcher />);

      const button = screen.getByRole('button');
      expect(button.textContent).toContain('Freighter - GACCOUNT0000000001');
    });

    it('should show account count', () => {
      renderWithWallet(<AccountSwitcher />);

      fireEvent.click(screen.getByRole('button'));

      expect(screen.getByText(/Available Accounts \(2\)/)).toBeInTheDocument();
    });
  });

  describe('Dropdown Interaction', () => {
    it('should toggle dropdown on button click', () => {
      renderWithWallet(<AccountSwitcher />);

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(screen.getByText(/Available Accounts/)).toBeInTheDocument();

      fireEvent.click(button);

      waitFor(() => {
        expect(screen.queryByText(/Available Accounts/)).not.toBeInTheDocument();
      });
    });

    it('should display all accounts in dropdown', () => {
      renderWithWallet(<AccountSwitcher />);

      fireEvent.click(screen.getByRole('button'));

      const menuItems = screen.getAllByRole('menuitem');
      expect(menuItems).toHaveLength(2);
      expect(menuItems[0]).toHaveTextContent('Freighter - GACCOUNT0000000001');
      expect(menuItems[1]).toHaveTextContent('Freighter - GACCOUNT0000000002');
    });

    it('should show checkmark on current account', () => {
      renderWithWallet(<AccountSwitcher />);

      fireEvent.click(screen.getByRole('button'));

      // menuitem buttons carry role="menuitem", not the implicit "button"
      // role, so they're queried separately from the dropdown toggle.
      const [firstAccountItem] = screen.getAllByRole('menuitem');

      expect(firstAccountItem.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('Account Switching', () => {
    it('should call switchAccount when selecting different account', () => {
      renderWithWallet(<AccountSwitcher />);

      const button = screen.getByRole('button');
      fireEvent.click(button);

      const menuItems = screen.getAllByRole('menuitem');
      fireEvent.click(menuItems[1]); // Second account

      expect(mockSwitchAccount).toHaveBeenCalledWith('GACCOUNT0000000002');
    });

    it('should not switch to same account', () => {
      renderWithWallet(<AccountSwitcher />);

      fireEvent.click(screen.getByRole('button'));

      const menuItems = screen.getAllByRole('menuitem');
      fireEvent.click(menuItems[0]); // First account (same as current)

      expect(mockSwitchAccount).not.toHaveBeenCalled();
    });

    it('should close dropdown after switching account', async () => {
      renderWithWallet(<AccountSwitcher />);

      fireEvent.click(screen.getByRole('button'));
      const menuItems = screen.getAllByRole('menuitem');
      fireEvent.click(menuItems[1]); // Different account

      await waitFor(() => {
        expect(screen.queryByText(/Available Accounts/)).not.toBeInTheDocument();
      });
    });
  });

  describe('Outside Click', () => {
    it('should close dropdown when clicking outside', async () => {
      const { container } = renderWithWallet(
        <div>
          <AccountSwitcher />
          <div data-testid="outside">Outside element</div>
        </div>
      );

      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText(/Available Accounts/)).toBeInTheDocument();

      const outside = screen.getByTestId('outside');
      fireEvent.mouseDown(outside);

      await waitFor(() => {
        expect(screen.queryByText(/Available Accounts/)).not.toBeInTheDocument();
      });
    });
  });

  describe('Focus management (#1140)', () => {
    it('moves focus into the menu when it opens', () => {
      renderWithWallet(<AccountSwitcher />);

      fireEvent.click(screen.getByRole('button'));

      const [firstMenuItem] = screen.getAllByRole('menuitem');
      expect(firstMenuItem).toHaveFocus();
    });

    it('closes and restores focus to the trigger button on Escape', () => {
      renderWithWallet(<AccountSwitcher />);

      const trigger = screen.getByRole('button');
      fireEvent.click(trigger);
      expect(screen.getByRole('menu')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it('restores focus to the trigger button after selecting an account', async () => {
      renderWithWallet(<AccountSwitcher />);

      const trigger = screen.getByRole('button');
      fireEvent.click(trigger);

      const menuItems = screen.getAllByRole('menuitem');
      fireEvent.click(menuItems[1]);

      // handleAccountChange awaits switchAccount() before restoring focus.
      await waitFor(() => {
        expect(trigger).toHaveFocus();
      });
    });

    it('wraps focus from the last item to the first on Tab', () => {
      renderWithWallet(<AccountSwitcher />);

      fireEvent.click(screen.getByRole('button'));
      const menuItems = screen.getAllByRole('menuitem');

      menuItems[menuItems.length - 1].focus();
      fireEvent.keyDown(document, { key: 'Tab' });

      expect(menuItems[0]).toHaveFocus();
    });

    it('wraps focus from the first item to the last on Shift+Tab', () => {
      renderWithWallet(<AccountSwitcher />);

      fireEvent.click(screen.getByRole('button'));
      const menuItems = screen.getAllByRole('menuitem');

      menuItems[0].focus();
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

      expect(menuItems[menuItems.length - 1]).toHaveFocus();
    });
  });
});
