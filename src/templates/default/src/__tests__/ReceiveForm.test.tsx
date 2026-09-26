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

  it('copies the address to the clipboard on click', async () => {
    renderWithWallet(<ReceiveForm />);

    fireEvent.click(screen.getByTestId('receive-form-copy'));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(ADDRESS);
    });
  });

  describe('SEP-7 payment request (#1056)', () => {
    it('renders a plain address (no SEP-7 request) when no amount is provided', () => {
      renderWithWallet(<ReceiveForm />);

      expect(screen.getByText('Receive Stellar Assets')).toBeInTheDocument();
      expect(screen.queryByTestId('receive-form-request-summary')).not.toBeInTheDocument();
    });

    it('shows a "Request Payment" heading and summary when an amount is provided', () => {
      renderWithWallet(<ReceiveForm amount="25" />);

      expect(screen.getByText('Request Payment')).toBeInTheDocument();
      expect(screen.getByTestId('receive-form-request-summary')).toHaveTextContent('Requesting 25 XLM');
    });

    it('shows the asset code in the summary for a non-native asset', () => {
      renderWithWallet(
        <ReceiveForm
          amount="10"
          asset={{ code: 'USDC', issuer: 'GISSUERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWJ4' }}
        />,
      );

      expect(screen.getByTestId('receive-form-request-summary')).toHaveTextContent('Requesting 10 USDC');
    });

    it('still displays the plain address as text even when a SEP-7 request is active', () => {
      renderWithWallet(<ReceiveForm amount="25" />);

      expect(screen.getByTestId('receive-form-address')).toHaveTextContent(ADDRESS);
    });

    it('copies the SEP-7 URI (not the bare address) to the clipboard when an amount is set', async () => {
      renderWithWallet(<ReceiveForm amount="25" />);

      fireEvent.click(screen.getByTestId('receive-form-copy'));

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          `web+stellar:pay?destination=${ADDRESS}&amount=25`,
        );
      });
    });

    it('uses a SEP-7 payment-request aria-label on the copy button when an amount is set', () => {
      renderWithWallet(<ReceiveForm amount="25" />);

      expect(screen.getByRole('button', { name: /copy payment request/i })).toBeInTheDocument();
    });

    it('falls back to a bare-address QR code if building the SEP-7 URI throws', () => {
      // asset without an issuer is invalid per buildSep7PayUri and should throw internally;
      // the component should swallow it and fall back rather than crash.
      renderWithWallet(
        // @ts-expect-error - deliberately omitting required issuer to exercise the fallback path
        <ReceiveForm amount="25" asset={{ code: 'USDC' }} />,
      );

      expect(screen.getByText('Receive Stellar Assets')).toBeInTheDocument();
      expect(screen.queryByTestId('receive-form-request-summary')).not.toBeInTheDocument();
    });
  });
});
