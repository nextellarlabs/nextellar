/**
 * @jest-environment jsdom
 *
 * WalletProvider network re-point (#794).
 */
import { jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { ReactNode } from 'react';

const serverUrls: string[] = [];

await jest.unstable_mockModule(
  '../../src/templates/default/src/lib/stellar-wallet-kit',
  () => ({
    kit: jest.fn(() => ({
      openModal: jest.fn(),
      setWallet: jest.fn(),
      getAddress: jest.fn(),
      disconnect: jest.fn(),
    })),
    WalletNetwork: { PUBLIC: 'PUBLIC', TESTNET: 'TESTNET' },
  }),
);

await jest.unstable_mockModule('../../src/templates/default/src/lib/storage', () => ({
  storage: {
    get: jest.fn(),
    set: jest.fn(),
    remove: jest.fn(),
  },
}));

await jest.unstable_mockModule('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn((url: string) => {
      serverUrls.push(url);
      return {
        accounts: () => ({
          accountId: () => ({ call: jest.fn() }),
        }),
        loadAccount: jest.fn(),
        submitTransaction: jest.fn(),
      };
    }),
  },
  TransactionBuilder: jest.fn(),
  Operation: { payment: jest.fn() },
  Networks: {
    PUBLIC: 'Public Global Stellar Network ; September 2015',
    TESTNET: 'Test SDF Network ; September 2015',
  },
  Asset: jest.fn(),
  Memo: { text: jest.fn() },
  BASE_FEE: '100',
}));

const { WalletProvider, useWalletConfig } = await import(
  '../../src/templates/default/src/contexts/WalletProvider'
);

describe('WalletProvider network switch (#794)', () => {
  beforeEach(() => {
    serverUrls.length = 0;
    jest.clearAllMocks();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <WalletProvider>{children}</WalletProvider>
  );

  it('re-points Horizon URL and passphrase when activeNetworkKey changes', () => {
    const { result } = renderHook(() => useWalletConfig(), { wrapper });

    expect(result.current?.horizonUrl).toBe(
      'https://horizon-testnet.stellar.org',
    );
    expect(result.current?.network).toBe('Test SDF Network ; September 2015');

    act(() => {
      result.current?.switchNetwork('mainnet');
    });

    expect(result.current?.activeNetworkKey).toBe('mainnet');
    expect(result.current?.horizonUrl).toBe('https://horizon.stellar.org');
    expect(result.current?.sorobanUrl).toBe('https://soroban.stellar.org');
    expect(result.current?.network).toBe(
      'Public Global Stellar Network ; September 2015',
    );
    expect(serverUrls).toContain('https://horizon.stellar.org');
  });
});
