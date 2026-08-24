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

      expect(screen.getByText('Freighter - GACCOUNT0000000001')).toBeInTheDocument();
      expect(screen.getByText('Freighter - GACCOUNT0000000002')).toBeInTheDocument();
    });

    it('should show checkmark on current account', () => {
      renderWithWallet(<AccountSwitcher />);

      fireEvent.click(screen.getByRole('button'));

      const buttons = screen.getAllByRole('button');
      // First button is dropdown toggle, second is first account
      const firstAccountButton = buttons[1];

      expect(firstAccountButton.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('Account Switching', () => {
    it('should call switchAccount when selecting different account', () => {
      renderWithWallet(<AccountSwitcher />);

      const button = screen.getByRole('button');
      fireEvent.click(button);

      const allButtons = screen.getAllByRole('button');
      // Click on second account (after dropdown button)
      fireEvent.click(allButtons[2]);

      expect(mockSwitchAccount).toHaveBeenCalledWith('GACCOUNT0000000002');
    });

    it('should not switch to same account', () => {
      renderWithWallet(<AccountSwitcher />);

      fireEvent.click(screen.getByRole('button'));

      const allButtons = screen.getAllByRole('button');
      fireEvent.click(allButtons[1]); // First account (same as current)

      expect(mockSwitchAccount).not.toHaveBeenCalled();
    });

    it('should close dropdown after switching account', async () => {
      renderWithWallet(<AccountSwitcher />);

      fireEvent.click(screen.getByRole('button'));
      const allButtons = screen.getAllByRole('button');
      fireEvent.click(allButtons[2]); // Different account

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
});
