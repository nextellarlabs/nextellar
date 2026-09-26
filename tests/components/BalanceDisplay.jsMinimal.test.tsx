/**
 * @jest-environment jsdom
 *
 * Regression coverage for the JavaScript minimal BalanceDisplay parity port.
 */
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import React from 'react';

const useWallet = jest.fn();
const useStellarBalances = jest.fn();

jest.unstable_mockModule('../../src/templates/js-minimal/src/contexts', () => ({ useWallet }));
jest.unstable_mockModule('../../src/templates/js-minimal/src/hooks/useStellarBalances', () => ({
  useStellarBalances,
}));

const { default: BalanceDisplay } = await import(
  '../../src/templates/js-minimal/src/components/BalanceDisplay'
);

describe('BalanceDisplay (js-minimal template)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useWallet.mockReturnValue({ connected: false, publicKey: undefined });
    useStellarBalances.mockReturnValue({
      balances: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
    });
  });

  it('renders the disconnected state without a wallet', () => {
    render(<BalanceDisplay />);
    expect(screen.getByText(/connect a wallet to view balances/i)).toBeInTheDocument();
  });
});
