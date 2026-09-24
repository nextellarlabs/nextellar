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
      expect(mockSendPayment).toHaveBeenCalledWith({
        to: VALID_ADDRESS,
        amount: '25',
        memo: 'rent',
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
});
