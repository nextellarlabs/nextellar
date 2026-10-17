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

    expect(screen.getByText(/connect your wallet to see your receive address/i)).toBeInTheDocument();
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

  describe('QR code download (#1108)', () => {
    it('does not show a download button before the QR code has generated', () => {
      renderWithWallet(<ReceiveForm />);

      expect(screen.queryByTestId('receive-form-download')).not.toBeInTheDocument();
    });

    it('shows a download button once the QR code is ready', async () => {
      renderWithWallet(<ReceiveForm />);

      await waitFor(() => {
        expect(screen.getByTestId('receive-form-download')).toBeInTheDocument();
      });
    });

    it('saves the QR data URL as a PNG file when the download button is clicked', async () => {
      renderWithWallet(<ReceiveForm />);

      await waitFor(() => {
        expect(screen.getByTestId('receive-form-download')).toBeInTheDocument();
      });

      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});

      fireEvent.click(screen.getByTestId('receive-form-download'));

      expect(clickSpy).toHaveBeenCalledTimes(1);
      clickSpy.mockRestore();
    });

    it('names the downloaded file after the address and sets a data URL as the href', async () => {
      renderWithWallet(<ReceiveForm />);

      await waitFor(() => {
        expect(screen.getByTestId('receive-form-download')).toBeInTheDocument();
      });

      let capturedAnchor: HTMLAnchorElement | null = null;
      const appendSpy = jest
        .spyOn(document.body, 'appendChild')
        .mockImplementation((node) => {
          capturedAnchor = node as HTMLAnchorElement;
          return node;
        });
      jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      jest.spyOn(document.body, 'removeChild').mockImplementation((node) => node);

      fireEvent.click(screen.getByTestId('receive-form-download'));

      expect(capturedAnchor).not.toBeNull();
      expect(capturedAnchor!.download).toBe(`stellar-address-${ADDRESS.slice(0, 8)}.png`);
      expect(capturedAnchor!.href).toMatch(/^data:/);

      appendSpy.mockRestore();
      jest.restoreAllMocks();
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
