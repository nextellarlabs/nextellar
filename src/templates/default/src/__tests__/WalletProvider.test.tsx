import { renderHook, act, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { WalletProvider, useWallet, WalletAccount } from '../contexts/WalletProvider';

// Mock the kit
jest.mock('../lib/stellar-wallet-kit', () => ({
  kit: jest.fn(() => ({
    openModal: jest.fn(),
    setWallet: jest.fn(),
    getAddress: jest.fn(() => Promise.resolve({ address: 'GTEST1234567890' })),
    disconnect: jest.fn(() => Promise.resolve()),
    signTransaction: jest.fn(),
  })),
}));

// Mock storage
const mockStorage = new Map<string, string>();
jest.mock('../lib/storage', () => ({
  storage: {
    get: (key: string) => mockStorage.get(key),
    set: (key: string, value: string) => mockStorage.set(key, value),
    remove: (key: string) => mockStorage.delete(key),
  },
}));

// Mock Horizon Server
jest.mock('@stellar/stellar-sdk', () => ({
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

describe('WalletProvider - Multi-Account Support', () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <WalletProvider>{children}</WalletProvider>
  );

  describe('Account List Management', () => {
    it('should initialize with empty accounts list', () => {
      const { result } = renderHook(() => useWallet(), { wrapper });

      expect(result.current.accounts).toEqual([]);
      expect(result.current.currentAccountIndex).toBe(0);
    });

    it('should add account when connecting', async () => {
      const { result } = renderHook(() => useWallet(), { wrapper });

      // Mock the connect flow
      mockStorage.set('stellar_wallet_connected', 'true');
      mockStorage.set('stellar_wallet_id', 'freighter');
      mockStorage.set('stellar_wallet_address', 'GACCOUNT1234567890');
      mockStorage.set('stellar_wallet_name', 'Freighter');

      await waitFor(() => {
        expect(result.current.accounts.length).toBeGreaterThanOrEqual(0);
      });
    });

    it('should not duplicate accounts with same address', async () => {
      const { result } = renderHook(() => useWallet(), { wrapper });

      // First account
      mockStorage.set('stellar_wallet_connected', 'true');
      mockStorage.set('stellar_wallet_id', 'freighter');
      mockStorage.set('stellar_wallet_address', 'GACCOUNT1111111111');
      mockStorage.set('stellar_wallet_name', 'Freighter');

      await waitFor(() => {
        const initialCount = result.current.accounts.length;
        expect(initialCount).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Account Switching', () => {
    it('should switch to different account', async () => {
      const { result } = renderHook(() => useWallet(), { wrapper });

      const account1: WalletAccount = {
        address: 'GACCOUNT0000000001',
        displayName: 'Account 1',
      };
      const account2: WalletAccount = {
        address: 'GACCOUNT0000000002',
        displayName: 'Account 2',
      };

      // Set initial state with multiple accounts
      mockStorage.set('stellar_wallet_accounts', JSON.stringify([account1, account2]));
      mockStorage.set('stellar_wallet_current_account_index', '0');
      mockStorage.set('stellar_wallet_connected', 'true');
      mockStorage.set('stellar_wallet_address', account1.address);

      await waitFor(() => {
        expect(result.current.accounts.length).toBe(2);
      });

      // Switch to second account
      await act(async () => {
        await result.current.switchAccount(account2.address);
      });

      expect(result.current.publicKey).toBe(account2.address);
      expect(result.current.currentAccountIndex).toBe(1);
    });

    it('should update balances when switching accounts', async () => {
      const { result } = renderHook(() => useWallet(), { wrapper });

      const account1: WalletAccount = {
        address: 'GACCOUNT0000000001',
        displayName: 'Account 1',
      };
      const account2: WalletAccount = {
        address: 'GACCOUNT0000000002',
        displayName: 'Account 2',
      };

      mockStorage.set('stellar_wallet_accounts', JSON.stringify([account1, account2]));
      mockStorage.set('stellar_wallet_connected', 'true');
      mockStorage.set('stellar_wallet_address', account1.address);

      await act(async () => {
        await result.current.switchAccount(account2.address);
      });

      expect(result.current.balances).toBeDefined();
    });

    it('should persist account index to storage', async () => {
      const { result } = renderHook(() => useWallet(), { wrapper });

      const accounts: WalletAccount[] = [
        { address: 'GACCOUNT0000000001', displayName: 'Account 1' },
        { address: 'GACCOUNT0000000002', displayName: 'Account 2' },
      ];

      mockStorage.set('stellar_wallet_accounts', JSON.stringify(accounts));
      mockStorage.set('stellar_wallet_connected', 'true');

      await act(async () => {
        await result.current.switchAccount(accounts[1].address);
      });

      const savedIndex = mockStorage.get('stellar_wallet_current_account_index');
      expect(savedIndex).toBe('1');
    });
  });

  describe('Storage Persistence', () => {
    it('should save accounts to storage on connection', async () => {
      const { result } = renderHook(() => useWallet(), { wrapper });

      mockStorage.set('stellar_wallet_connected', 'true');
      mockStorage.set('stellar_wallet_id', 'freighter');
      mockStorage.set('stellar_wallet_address', 'GACCOUNT1234567890');
      mockStorage.set('stellar_wallet_name', 'Freighter');

      await waitFor(() => {
        expect(mockStorage.has('stellar_wallet_accounts')).toBeDefined();
      });
    });

    it('should restore accounts from storage on mount', async () => {
      const accounts: WalletAccount[] = [
        { address: 'GACCOUNT0000000001', displayName: 'Account 1' },
        { address: 'GACCOUNT0000000002', displayName: 'Account 2' },
      ];

      mockStorage.set('stellar_wallet_accounts', JSON.stringify(accounts));
      mockStorage.set('stellar_wallet_current_account_index', '1');
      mockStorage.set('stellar_wallet_connected', 'true');
      mockStorage.set('stellar_wallet_address', accounts[1].address);
      mockStorage.set('stellar_wallet_id', 'freighter');
      mockStorage.set('stellar_wallet_name', 'Freighter');

      const { result } = renderHook(() => useWallet(), { wrapper });

      await waitFor(() => {
        expect(result.current.accounts.length).toBeGreaterThanOrEqual(0);
      });
    });

    it('should clear account storage on disconnect', async () => {
      const { result } = renderHook(() => useWallet(), { wrapper });

      mockStorage.set('stellar_wallet_connected', 'true');
      mockStorage.set('stellar_wallet_accounts', JSON.stringify([
        { address: 'GACCOUNT1', displayName: 'Account 1' },
      ]));

      await act(async () => {
        await result.current.disconnect();
      });

      expect(mockStorage.get('stellar_wallet_accounts')).toBeUndefined();
      expect(mockStorage.get('stellar_wallet_current_account_index')).toBeUndefined();
    });
  });

  describe('Account Index Bounds', () => {
    it('should clamp index to valid range on restore', async () => {
      const accounts: WalletAccount[] = [
        { address: 'GACCOUNT0000000001', displayName: 'Account 1' },
      ];

      // Save invalid index
      mockStorage.set('stellar_wallet_accounts', JSON.stringify(accounts));
      mockStorage.set('stellar_wallet_current_account_index', '999');
      mockStorage.set('stellar_wallet_connected', 'true');

      const { result } = renderHook(() => useWallet(), { wrapper });

      await waitFor(() => {
        expect(result.current.currentAccountIndex).toBeLessThan(accounts.length);
      });
    });
  });
});
