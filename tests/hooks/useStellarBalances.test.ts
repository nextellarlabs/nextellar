/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock the Stellar SDK module entirely since it's not a dependency of the main CLI
jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn(),
  },
}));

// Import types and implementation after mocking
const { useStellarBalances } = require('../../src/lib/hooks/useStellarBalances');

type Balance = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  limit?: string;
};

// Mock Horizon class
const MockedHorizon = {
  Server: jest.fn(),
};

describe('useStellarBalances', () => {
  let mockServer: any;
  let mockAccountsCall: jest.Mock;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();

    // Mock console.error to avoid test noise
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Create mock server with chained methods
    mockAccountsCall = jest.fn();
    mockServer = {
      accounts: jest.fn().mockReturnValue({
        accountId: jest.fn().mockReturnValue({
          call: mockAccountsCall,
        }),
      }),
    };

    require('@stellar/stellar-sdk').Horizon.Server.mockImplementation(() => mockServer);
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  const mockAccountData = {
    balances: [
      {
        asset_type: 'native',
        balance: '100.0000000',
      },
      {
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        asset_issuer: 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO',
        balance: '250.5000000',
        limit: '922337203685.4775807',
      },
    ],
  };

  describe('Basic Functionality', () => {
    it('should return initial state correctly', () => {
      const { result } = renderHook(() => useStellarBalances());

      expect(result.current.balances).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(typeof result.current.refresh).toBe('function');
      expect(typeof result.current.stopPolling).toBe('function');
    });

    it('should return empty balances when publicKey is falsy', async () => {
      const { result } = renderHook(() => useStellarBalances(null));

      await waitFor(() => {
        expect(result.current.balances).toEqual([]);
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
      });

      // Should not have called the server
      expect(mockAccountsCall).not.toHaveBeenCalled();
    });

    it('should fetch balances successfully with valid publicKey', async () => {
      const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      mockAccountsCall.mockResolvedValueOnce(mockAccountData);

      const { result } = renderHook(() => useStellarBalances(publicKey));

      // Should start loading
      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.balances).toHaveLength(2);
      expect(result.current.balances[0]).toEqual({
        asset_type: 'native',
        asset_code: undefined,
        asset_issuer: undefined,
        balance: '100.0000000',
        limit: undefined,
      });
      expect(result.current.balances[1]).toEqual({
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        asset_issuer: 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO',
        balance: '250.5000000',
        limit: '922337203685.4775807',
      });
      expect(result.current.error).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle account not found (404) gracefully', async () => {
      const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      const notFoundError = {
        response: { status: 404 },
        name: 'NotFoundError',
      };
      mockAccountsCall.mockRejectedValueOnce(notFoundError);

      const { result } = renderHook(() => useStellarBalances(publicKey));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.balances).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('should handle network errors', async () => {
      const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      const networkError = new Error('Network error: fetch failed');
      mockAccountsCall.mockRejectedValueOnce(networkError);

      const { result } = renderHook(() => useStellarBalances(publicKey));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toContain('Network error');
      expect(result.current.balances).toEqual([]);
    });

    it('should handle server errors (500)', async () => {
      const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      const serverError = {
        response: { status: 500 },
        message: 'Internal Server Error',
      };
      mockAccountsCall.mockRejectedValueOnce(serverError);

      const { result } = renderHook(() => useStellarBalances(publicKey));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toContain('Network error');
    });

    it('should handle invalid public key format', async () => {
      const invalidPublicKey = 'invalid-key';

      const { result } = renderHook(() => useStellarBalances(invalidPublicKey));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toContain('Invalid Stellar public key format');
    });

    it('should preserve previous balances on error', async () => {
      const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      
      // First successful call
      mockAccountsCall.mockResolvedValueOnce(mockAccountData);

      const { result } = renderHook(() => useStellarBalances(publicKey));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.balances).toHaveLength(2);
      });

      const previousBalances = result.current.balances;

      // Second call fails
      mockAccountsCall.mockRejectedValueOnce(new Error('Network error'));

      await act(async () => {
        await result.current.refresh();
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Balances should be preserved
      expect(result.current.balances).toEqual(previousBalances);
      expect(result.current.error).toBeInstanceOf(Error);
    });
  });

  describe('Polling Functionality', () => {
    it('should start polling when pollIntervalMs is provided', async () => {
      const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      mockAccountsCall.mockResolvedValue(mockAccountData);

      const { result } = renderHook(() =>
        useStellarBalances(publicKey, { pollIntervalMs: 10000 })
      );

      // Initial call
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockAccountsCall).toHaveBeenCalledTimes(1);

      // Advance time to trigger polling
      act(() => {
        jest.advanceTimersByTime(10000);
      });

      await waitFor(() => {
        expect(mockAccountsCall).toHaveBeenCalledTimes(2);
      });
    });

    it('should enforce minimum polling interval', async () => {
      const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      mockAccountsCall.mockResolvedValue(mockAccountData);

      const { result } = renderHook(() =>
        useStellarBalances(publicKey, { pollIntervalMs: 1000 }) // Below 5000ms minimum
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockAccountsCall).toHaveBeenCalledTimes(1);

      // Advance by 1 second (should not trigger)
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(mockAccountsCall).toHaveBeenCalledTimes(1);

      // Advance to minimum interval (5000ms)
      act(() => {
        jest.advanceTimersByTime(4000);
      });

      await waitFor(() => {
        expect(mockAccountsCall).toHaveBeenCalledTimes(2);
      });
    });

    it('should stop polling when stopPolling is called', async () => {
      const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      mockAccountsCall.mockResolvedValue(mockAccountData);

      const { result } = renderHook(() =>
        useStellarBalances(publicKey, { pollIntervalMs: 5000 })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockAccountsCall).toHaveBeenCalledTimes(1);

      // Stop polling
      act(() => {
        result.current.stopPolling();
      });

      // Advance time
      act(() => {
        jest.advanceTimersByTime(10000);
      });

      // Should not have made additional calls
      expect(mockAccountsCall).toHaveBeenCalledTimes(1);
    });

    it('should restart polling when publicKey changes', async () => {
      const publicKey1 = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      const publicKey2 = 'GDQJUTQYK2MQX2VGDR2FYWLIYAQIEGXTQVTFEMGH2BEWFG4BRUY4XBKT';
      mockAccountsCall.mockResolvedValue(mockAccountData);

      const { result, rerender } = renderHook(
        ({ publicKey }) => useStellarBalances(publicKey, { pollIntervalMs: 5000 }),
        { initialProps: { publicKey: publicKey1 } }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockAccountsCall).toHaveBeenCalledTimes(1);

      // Change publicKey
      rerender({ publicKey: publicKey2 });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should have made new call for new publicKey
      expect(mockAccountsCall).toHaveBeenCalledTimes(2);
    });
  });

  describe('Refresh Functionality', () => {
    it('should allow manual refresh', async () => {
      const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      mockAccountsCall.mockResolvedValue(mockAccountData);

      const { result } = renderHook(() => useStellarBalances(publicKey));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockAccountsCall).toHaveBeenCalledTimes(1);

      // Manual refresh
      await act(async () => {
        await result.current.refresh();
      });

      expect(mockAccountsCall).toHaveBeenCalledTimes(2);
    });

    it('should prevent duplicate requests during refresh', async () => {
      const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      
      // Make the call slow
      let resolvePromise: (value: any) => void;
      const slowPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockAccountsCall.mockReturnValueOnce(slowPromise);

      const { result } = renderHook(() => useStellarBalances(publicKey));

      expect(result.current.loading).toBe(true);

      // Try to call refresh while already loading
      await act(async () => {
        await result.current.refresh();
      });

      // Should still only have one call in flight
      expect(mockAccountsCall).toHaveBeenCalledTimes(1);

      // Resolve the promise
      act(() => {
        resolvePromise!(mockAccountData);
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe('Horizon URL Configuration', () => {
    it('should use custom Horizon URL', async () => {
      const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      const customHorizonUrl = 'https://horizon.stellar.org';
      mockAccountsCall.mockResolvedValue(mockAccountData);

      renderHook(() =>
        useStellarBalances(publicKey, { horizonUrl: customHorizonUrl })
      );

      expect(require('@stellar/stellar-sdk').Horizon.Server).toHaveBeenCalledWith(customHorizonUrl);
    });

    it('should reinitialize server when Horizon URL changes', async () => {
      const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      const initialUrl = 'https://horizon-testnet.stellar.org';
      const newUrl = 'https://horizon.stellar.org';
      mockAccountsCall.mockResolvedValue(mockAccountData);

      const { rerender } = renderHook(
        ({ horizonUrl }) => useStellarBalances(publicKey, { horizonUrl }),
        { initialProps: { horizonUrl: initialUrl } }
      );

      expect(require('@stellar/stellar-sdk').Horizon.Server).toHaveBeenCalledWith(initialUrl);

      // Change URL
      rerender({ horizonUrl: newUrl });

      expect(require('@stellar/stellar-sdk').Horizon.Server).toHaveBeenCalledWith(newUrl);
      expect(require('@stellar/stellar-sdk').Horizon.Server).toHaveBeenCalledTimes(2);
    });
  });

  describe('Data Validation', () => {
    it('should handle invalid account structure', async () => {
      const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      mockAccountsCall.mockResolvedValueOnce({ invalid: 'structure' });

      const { result } = renderHook(() => useStellarBalances(publicKey));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toContain('Invalid account structure');
    });

    it('should handle invalid balance structure', async () => {
      const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      const invalidBalanceData = {
        balances: [
          {
            asset_type: 'native',
            balance: 100, // Should be string
          },
        ],
      };
      mockAccountsCall.mockResolvedValueOnce(invalidBalanceData);

      const { result } = renderHook(() => useStellarBalances(publicKey));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toContain('Invalid balance structure');
    });
  });

  describe('Browser Environment', () => {
    it('should handle non-browser environment', async () => {
      const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      
      // Mock window as undefined
      const originalWindow = global.window;
      // @ts-ignore
      delete global.window;

      const { result } = renderHook(() => useStellarBalances(publicKey));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toContain('Browser environment required');

      // Restore window
      global.window = originalWindow;
    });
  });

  describe('Cleanup', () => {
    it('should clean up polling on unmount', async () => {
      const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
      mockAccountsCall.mockResolvedValue(mockAccountData);

      const { result, unmount } = renderHook(() =>
        useStellarBalances(publicKey, { pollIntervalMs: 5000 })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockAccountsCall).toHaveBeenCalledTimes(1);

      // Unmount component
      unmount();

      // Advance time
      act(() => {
        jest.advanceTimersByTime(10000);
      });

      // Should not make additional calls after unmount
      expect(mockAccountsCall).toHaveBeenCalledTimes(1);
    });
  });
});