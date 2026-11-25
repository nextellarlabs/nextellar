/** @jest-environment jsdom */
import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

const ADDRESS = 'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ';
const BALANCE_ID = '00000000claimable';
const mockList = jest.fn<() => Promise<unknown>>();
const mockLedger = jest.fn<() => Promise<unknown>>().mockResolvedValue({ closed_at: '2026-01-01T00:00:00Z' });
const mockSubmit = jest.fn<() => Promise<unknown>>().mockResolvedValue({});
const mockSign = jest.fn<() => Promise<string>>().mockResolvedValue('signed-xdr');
const mockClaimOperation = jest.fn<(args: { balanceId: string }) => unknown>().mockReturnValue('claim-operation');
const mockFromXDR = jest.fn<() => unknown>().mockReturnValue('signed-transaction');

class MockTransactionBuilder {
  static fromXDR = mockFromXDR;
  addOperation = jest.fn().mockReturnThis();
  setTimeout = jest.fn().mockReturnThis();
  build = jest.fn().mockReturnValue({ toXDR: () => 'unsigned-xdr' });
}

class MockServer {
  claimableBalances() { return { claimant: () => ({ limit: () => ({ call: mockList }) }) }; }
  ledgers() { return { ledger: () => ({ call: mockLedger }) }; }
  loadAccount = jest.fn<() => Promise<unknown>>().mockResolvedValue({});
  submitTransaction = mockSubmit;
}

await jest.unstable_mockModule('@stellar/stellar-sdk', () => ({
  BASE_FEE: '100',
  Networks: { TESTNET: 'Test SDF Network ; September 2015' },
  Horizon: { Server: MockServer },
  Operation: { claimClaimableBalance: mockClaimOperation },
  TransactionBuilder: MockTransactionBuilder,
}));
await jest.unstable_mockModule('../lib/stellar-wallet-kit', () => ({ signTransaction: mockSign }));

const { useClaimableBalances } = await import('../hooks/useClaimableBalances');
const { WalletContext } = await import('../contexts/WalletProvider');
const mockRefreshWallet = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

const wrapper = ({ children }: { children: ReactNode }) => createElement(
  WalletContext.Provider,
  { value: {
    connected: true, publicKey: ADDRESS, networkMismatch: false,
    refreshBalances: mockRefreshWallet,
  } },
  children,
);

describe('useClaimableBalances claim flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockList.mockResolvedValueOnce({
      records: [{
        id: BALANCE_ID, asset: 'native', amount: '2.0000000', last_modified_ledger: 123,
        claimants: [{ destination: ADDRESS, predicate: { rel_before: '3600' } }],
      }],
    }).mockResolvedValue({ records: [] });
  });

  it('resolves a relative predicate, signs, submits, and removes the claimed row', async () => {
    // Freeze time within the relative claim window.
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-01T00:30:00Z'));
    try {
      const { result } = renderHook(() => useClaimableBalances(ADDRESS), { wrapper });
      await waitFor(() => expect(result.current.balances).toHaveLength(1));
      expect(mockLedger).toHaveBeenCalledTimes(1);
      await act(async () => { await result.current.claim(BALANCE_ID); });
      expect(mockClaimOperation).toHaveBeenCalledWith({ balanceId: BALANCE_ID });
      expect(mockSign).toHaveBeenCalledWith({ unsignedTransaction: 'unsigned-xdr', address: ADDRESS });
      expect(mockSubmit).toHaveBeenCalledWith('signed-transaction');
      expect(mockRefreshWallet).toHaveBeenCalledTimes(1);
      expect(result.current.balances).toHaveLength(0);
      expect(result.current.claimedId).toBe(BALANCE_ID);
    } finally {
      clock.mockRestore();
    }
  });
});
