/**
 * @jest-environment jsdom
 *
 * Real-component coverage for #1067 (persist the active account across a
 * multi-account wallet session, scoped per wallet/network).
 *
 * WalletProvider.test.tsx in this same directory imports '../contexts/WalletProvider'
 * — a specifier jest.config.mjs's moduleNameMapper redirects to
 * src/mocks/wallet-contexts-mock.ts, a static mock whose connect/disconnect/
 * switchAccount are no-op stubs. That file has never actually exercised the
 * real WalletProvider (pre-existing, unrelated to this batch; disclosed in
 * the PR rather than fixed here). This file imports the real component via
 * an explicit '.tsx' extension, which the mapper's exact-match regexes
 * (`^\.\./contexts$`, `^\.\./contexts/WalletProvider$`) do not match, so it
 * genuinely renders WalletProvider.tsx.
 */
import { jest } from '@jest/globals';
import { renderHook, act, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';

// See WalletProvider.test.tsx's own top-of-file comment for why
// jest.unstable_mockModule (not jest.mock) is required here.

await jest.unstable_mockModule('../lib/stellar-wallet-kit', () => ({
  kit: jest.fn(() => ({
    openModal: jest.fn(),
    setWallet: jest.fn(),
    getAddress: jest.fn(() => Promise.resolve({ address: 'GTEST1234567890' })),
    disconnect: jest.fn(() => Promise.resolve()),
    signTransaction: jest.fn(),
  })),
  WalletNetwork: { PUBLIC: 'PUBLIC', TESTNET: 'TESTNET' },
}));

const mockStorage = new Map<string, string>();
await jest.unstable_mockModule('../lib/storage', () => ({
  storage: {
    get: (key: string) => mockStorage.get(key),
    set: (key: string, value: string) => mockStorage.set(key, value),
    remove: (key: string) => mockStorage.delete(key),
  },
}));

await jest.unstable_mockModule('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn(() => ({
      accounts: () => ({
        accountId: () => ({
          call: jest.fn(() =>
            Promise.resolve({
              balances: [{ balance: '100', asset_type: 'native' }],
            })
          ),
        }),
      }),
      loadAccount: jest.fn(() => Promise.resolve({})),
      submitTransaction: jest.fn(() => Promise.resolve({})),
    })),
  },
  TransactionBuilder: jest.fn(),
  Operation: { payment: jest.fn() },
  Networks: { PUBLIC: 'PUBLIC', TESTNET: 'TESTNET' },
  Asset: jest.fn(),
  Memo: { text: jest.fn() },
  BASE_FEE: '100',
}));

// The explicit .tsx extension is load-bearing: it is what keeps this
// specifier from matching moduleNameMapper's mock redirect (see file doc
// comment above).
const { WalletProvider, useWallet } = await import('../contexts/WalletProvider.tsx');
type WalletAccount = { address: string; displayName?: string };

describe('WalletProvider - Account Persistence Scoped Per Wallet/Network (#1067)', () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <WalletProvider>{children}</WalletProvider>
  );

  // The mocked wallet kit's getAddress() always resolves to this address;
  // WalletProvider's mount-time auto-reconnect only restores saved accounts
  // when the freshly-fetched address matches `stellar_wallet_address`, so
  // every test here that exercises restore-on-mount uses this exact address.
  const RECONNECT_ADDRESS = 'GTEST1234567890';

  it('persists the active account under a key scoped by wallet id and network, restoring it across a simulated remount', async () => {
    // The mocked wallet kit's getAddress() always resolves to RECONNECT_ADDRESS,
    // so the account initially marked active must be that address for the
    // first remount's auto-reconnect to find and load the saved account list
    // at all; switching to account2 afterwards then exercises the actual
    // scoped-persistence behavior under test.
    const account1: WalletAccount = { address: RECONNECT_ADDRESS, displayName: 'Account 1' };
    const account2: WalletAccount = { address: 'GACCOUNT0000000002', displayName: 'Account 2' };

    mockStorage.set('stellar_wallet_connected', 'true');
    mockStorage.set('stellar_wallet_id', 'freighter');
    mockStorage.set('stellar_wallet_address', account1.address);
    mockStorage.set('stellar_wallet_name', 'Freighter');
    mockStorage.set(
      'stellar_wallet_accounts:testnet:freighter',
      JSON.stringify([account1, account2])
    );
    mockStorage.set('stellar_wallet_current_account_index:testnet:freighter', '0');

    // Simulate a remount picking up the previously-persisted session: a
    // fresh renderHook call, same storage, no re-connect from the user.
    const remounted = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => {
      expect(remounted.result.current.accounts.length).toBe(2);
    });

    await act(async () => {
      await remounted.result.current.switchAccount(account2.address);
    });

    expect(remounted.result.current.currentAccountIndex).toBe(1);
    expect(mockStorage.get('stellar_wallet_current_account_index:testnet:freighter')).toBe('1');

    // Restore `stellar_wallet_address` back to what the mocked wallet kit
    // actually reports: switchAccount above overwrote it with account2's
    // (real, user-selected) address, but the mock's getAddress() can only
    // ever resolve to RECONNECT_ADDRESS, so a real third-party wallet
    // extension standing behind this mock would report RECONNECT_ADDRESS
    // again on the next reconnect regardless of which account is active.
    mockStorage.set('stellar_wallet_address', RECONNECT_ADDRESS);

    // A second, independent remount reads the same scoped key back and
    // restores the switched-to account (index 1), not the original default.
    const secondRemount = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => {
      expect(secondRemount.result.current.accounts.length).toBe(2);
    });
    expect(secondRemount.result.current.currentAccountIndex).toBe(1);

    remounted.unmount();
    secondRemount.unmount();
  });

  it("does not let one network see another network's persisted accounts", async () => {
    mockStorage.set(
      'stellar_wallet_accounts:testnet:freighter',
      JSON.stringify([{ address: RECONNECT_ADDRESS, displayName: 'Testnet Account' }])
    );
    mockStorage.set('stellar_wallet_current_account_index:testnet:freighter', '0');
    mockStorage.set(
      'stellar_wallet_accounts:mainnet:freighter',
      JSON.stringify([
        { address: 'GMAINNETACCOUNT0001', displayName: 'Mainnet Account A' },
        { address: 'GMAINNETACCOUNT0002', displayName: 'Mainnet Account B' },
      ])
    );
    mockStorage.set('stellar_wallet_current_account_index:mainnet:freighter', '1');
    mockStorage.set('stellar_wallet_connected', 'true');
    mockStorage.set('stellar_wallet_id', 'freighter');
    mockStorage.set('stellar_wallet_address', RECONNECT_ADDRESS);
    mockStorage.set('stellar_wallet_name', 'Freighter');
    // WalletProvider reads its active network from this key on mount.
    mockStorage.set('stellar_network', 'testnet');

    const { result } = renderHook(() => useWallet(), { wrapper });

    await waitFor(() => {
      expect(result.current.accounts.length).toBe(1);
    });
    expect(result.current.accounts[0].address).toBe(RECONNECT_ADDRESS);
    expect(result.current.currentAccountIndex).toBe(0);
  });

  it("scopes accounts by wallet id so switching wallet extensions does not inherit the previous wallet's account list", async () => {
    mockStorage.set(
      'stellar_wallet_accounts:testnet:freighter',
      JSON.stringify([{ address: 'GFREIGHTERACCOUNT01', displayName: 'Freighter Account' }])
    );
    mockStorage.set('stellar_wallet_current_account_index:testnet:freighter', '0');
    mockStorage.set(
      'stellar_wallet_accounts:testnet:albedo',
      JSON.stringify([{ address: RECONNECT_ADDRESS, displayName: 'Albedo Account' }])
    );
    mockStorage.set('stellar_wallet_current_account_index:testnet:albedo', '0');
    mockStorage.set('stellar_wallet_connected', 'true');
    mockStorage.set('stellar_wallet_id', 'albedo');
    mockStorage.set('stellar_wallet_address', RECONNECT_ADDRESS);
    mockStorage.set('stellar_wallet_name', 'Albedo');

    const { result } = renderHook(() => useWallet(), { wrapper });

    await waitFor(() => {
      expect(result.current.accounts.length).toBe(1);
    });
    expect(result.current.accounts[0].address).toBe(RECONNECT_ADDRESS);
  });

  it("removes only the active wallet/network's scoped keys on disconnect", async () => {
    mockStorage.set(
      'stellar_wallet_accounts:testnet:freighter',
      JSON.stringify([{ address: RECONNECT_ADDRESS, displayName: 'Account 1' }])
    );
    mockStorage.set('stellar_wallet_current_account_index:testnet:freighter', '0');
    mockStorage.set(
      'stellar_wallet_accounts:mainnet:freighter',
      JSON.stringify([{ address: 'GMAINNETACCOUNT0001', displayName: 'Mainnet Account' }])
    );
    mockStorage.set('stellar_wallet_current_account_index:mainnet:freighter', '0');
    mockStorage.set('stellar_wallet_connected', 'true');
    mockStorage.set('stellar_wallet_id', 'freighter');
    mockStorage.set('stellar_wallet_address', RECONNECT_ADDRESS);
    mockStorage.set('stellar_wallet_name', 'Freighter');

    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => {
      expect(result.current.accounts.length).toBe(1);
    });

    await act(async () => {
      await result.current.disconnect();
    });

    expect(mockStorage.get('stellar_wallet_accounts:testnet:freighter')).toBeUndefined();
    expect(mockStorage.get('stellar_wallet_current_account_index:testnet:freighter')).toBeUndefined();
    // The other network's persisted accounts are untouched by disconnecting
    // the current (testnet) session.
    expect(mockStorage.get('stellar_wallet_accounts:mainnet:freighter')).toBeDefined();
    expect(mockStorage.get('stellar_wallet_current_account_index:mainnet:freighter')).toBeDefined();
  });
});
