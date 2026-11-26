/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SendForm from '../components/SendForm';
import { WalletContext } from '../contexts/WalletProvider';
import { ReactNode } from 'react';

const VALID_ADDRESS = 'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ';

describe('SendForm Component (#879)', () => {
  const mockSendPayment = jest.fn();

  const baseWalletState = {
    connected: true,
    publicKey: VALID_ADDRESS,
    walletName: 'Freighter',
    balances: [],
    accounts: [],
    connect: jest.fn(),
    disconnect: jest.fn(),
    refreshBalances: jest.fn(),
    switchAccount: jest.fn(),
    currentAccountIndex: 0,
    sendPayment: mockSendPayment,
  };

  const renderWithWallet = (component: ReactNode, overrides: Record<string, unknown> = {}) => {
    return render(
      <WalletContext.Provider value={{ ...baseWalletState, ...overrides }}>
        {component}
      </WalletContext.Provider>,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disables every field when no wallet is connected', () => {
    renderWithWallet(<SendForm />, { connected: false });

    expect(screen.getByLabelText('To')).toBeDisabled();
    expect(screen.getByLabelText('Amount (XLM)')).toBeDisabled();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('shows a validation error for an invalid address and keeps submit disabled', () => {
    renderWithWallet(<SendForm />);

    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'not-an-address' } });
    fireEvent.change(screen.getByLabelText('Amount (XLM)'), { target: { value: '10' } });

    expect(screen.getByText(/valid stellar public key/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
    expect(mockSendPayment).not.toHaveBeenCalled();
  });

  it('shows a validation error for a non-positive amount and keeps submit disabled', () => {
    renderWithWallet(<SendForm />);

    fireEvent.change(screen.getByLabelText('To'), { target: { value: VALID_ADDRESS } });
    fireEvent.change(screen.getByLabelText('Amount (XLM)'), { target: { value: '-5' } });

    expect(screen.getByText(/greater than 0/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('calls sendPayment with the entered fields and shows a success badge once resolved', async () => {
    mockSendPayment.mockResolvedValue({});
    renderWithWallet(<SendForm />);

    fireEvent.change(screen.getByLabelText('To'), { target: { value: VALID_ADDRESS } });
    fireEvent.change(screen.getByLabelText('Amount (XLM)'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'rent' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      // objectContaining: SendForm also passes `asset` and `sponsor` (#951).
      expect(mockSendPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          to: VALID_ADDRESS,
          amount: '25',
          memo: 'rent',
        }),
      );
      expect(mockSendPayment).toHaveBeenCalledWith({
        to: VALID_ADDRESS,
        amount: '25',
        asset: 'XLM',
        memo: 'rent',
        sponsor: undefined,
      });
    });

    expect(await screen.findByText('Sent')).toBeInTheDocument();
    // Fields clear on success.
    expect(screen.getByLabelText('To')).toHaveValue('');
  });

  it('shows a failed badge and the error message when sendPayment rejects', async () => {
    mockSendPayment.mockRejectedValue(new Error('Insufficient balance'));
    renderWithWallet(<SendForm />);

    fireEvent.change(screen.getByLabelText('To'), { target: { value: VALID_ADDRESS } });
    fireEvent.change(screen.getByLabelText('Amount (XLM)'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Insufficient balance')).toBeInTheDocument();
  });

  it('disables submit and explains when the connected wallet has no sendPayment support', () => {
    renderWithWallet(<SendForm />, { sendPayment: undefined });

    fireEvent.change(screen.getByLabelText('To'), { target: { value: VALID_ADDRESS } });
    fireEvent.change(screen.getByLabelText('Amount (XLM)'), { target: { value: '10' } });

    expect(screen.getByText(/does not support sending payments/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  describe('Muxed Account Support (#1457)', () => {
    const VALID_MUXED = 'MDQG65JVIKL4TDRNDXVUD5GJHNDY22VAQNC5ZZ5EUJ2EFHGUCRDRAAAAAAAAAABQHFUZQ';
    const BAD_CHECKSUM_MUXED = 'MDQG65JVIKL4TDRNDXVUD5GJHNDY22VAQNC5ZZ5EUJ2EFHGUCRDRAAAAAAAAAABQHFUZX';
    const MALFORMED_MUXED = 'M12345';

    it('accepts, validates, and decodes a valid M... muxed address into base account + id', async () => {
      mockSendPayment.mockResolvedValue({});
      renderWithWallet(<SendForm />);

      fireEvent.change(screen.getByLabelText('To'), { target: { value: VALID_MUXED } });
      fireEvent.change(screen.getByLabelText('Amount (XLM)'), { target: { value: '15' } });

      const decodedBadge = await screen.findByTestId('send-form-muxed-decoded');
      expect(decodedBadge).toBeInTheDocument();
      expect(decodedBadge.textContent).toContain('Muxed: Base');
      expect(decodedBadge.textContent).toContain('ID 12345');

      expect(screen.getByRole('button', { name: /send/i })).not.toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: /send/i }));

      await waitFor(() => {
        expect(mockSendPayment).toHaveBeenCalledWith(
          expect.objectContaining({
            to: VALID_MUXED,
            amount: '15',
          })
        );
      });
    });

    it('rejects malformed M... muxed address and keeps submit disabled', () => {
      renderWithWallet(<SendForm />);

      fireEvent.change(screen.getByLabelText('To'), { target: { value: MALFORMED_MUXED } });
      fireEvent.change(screen.getByLabelText('Amount (XLM)'), { target: { value: '10' } });

      expect(screen.getByText(/valid stellar public key/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
      expect(screen.queryByTestId('send-form-muxed-decoded')).not.toBeInTheDocument();
    });

    it('rejects checksum-invalid M... muxed address and keeps submit disabled', () => {
      renderWithWallet(<SendForm />);

      fireEvent.change(screen.getByLabelText('To'), { target: { value: BAD_CHECKSUM_MUXED } });
      fireEvent.change(screen.getByLabelText('Amount (XLM)'), { target: { value: '10' } });

      expect(screen.getByText(/valid stellar public key/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
      expect(screen.queryByTestId('send-form-muxed-decoded')).not.toBeInTheDocument();
    });
  });
});
