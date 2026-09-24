/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReceiveForm from '../components/ReceiveForm';
import { WalletContext } from '../contexts/WalletProvider';
import { ReactNode } from 'react';

const ADDRESS = 'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ';

describe('ReceiveForm Component (#880)', () => {
  const baseWalletState = {
    connected: true,
    publicKey: ADDRESS,
    walletName: 'Freighter',
    balances: [],
    accounts: [],
    connect: jest.fn(),
    disconnect: jest.fn(),
    refreshBalances: jest.fn(),
    switchAccount: jest.fn(),
    currentAccountIndex: 0,
    sendPayment: undefined,
  };

  const renderWithWallet = (component: ReactNode, overrides: Record<string, unknown> = {}) => {
    return render(
      <WalletContext.Provider value={{ ...baseWalletState, ...overrides }}>
        {component}
      </WalletContext.Provider>,
    );
  };

  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    Object.assign(navigator, { clipboard: originalClipboard });
  });

  it('shows a connect-wallet prompt instead of an address when disconnected', () => {
    renderWithWallet(<ReceiveForm />, { connected: false, publicKey: undefined });

    expect(screen.getByText(/connect a wallet to receive/i)).toBeInTheDocument();
    expect(screen.queryByText(ADDRESS)).not.toBeInTheDocument();
  });

  it('renders the connected wallet address', () => {
    renderWithWallet(<ReceiveForm />);

    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
  });

  it('copies the address to the clipboard and shows a confirmation on click', async () => {
    renderWithWallet(<ReceiveForm />);

    fireEvent.click(screen.getByRole('button', { name: /copy address/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(ADDRESS);
    });
    expect(await screen.findByText(/copied to clipboard/i)).toBeInTheDocument();
  });
});
