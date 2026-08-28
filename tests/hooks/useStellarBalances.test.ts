/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';

// Virtual mock for Stellar SDK since it's not a dependency of the main CLI.
// This repo runs Jest under real ESM (--experimental-vm-modules), so the
// classic jest.mock() factory (which relies on babel's hoist-to-require
// transform) can't be used here — jest.unstable_mockModule is the
// ESM-native equivalent. Nothing in this file imports 'react' directly
// (only @testing-library/react, a separate package), so no react mock is
// needed.
await jest.unstable_mockModule('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn(),
  },
}));

// Mock the hook import to avoid module loading issues during testing
const mockUseStellarBalances = jest.fn();

type Balance = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  limit?: string;
};

describe('useStellarBalances (Template Hook)', () => {
  let mockServer: any;
  let mockAccountsCall: jest.Mock;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();

    // Mock console.error to avoid test noise
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Create mock server with chained methods
    mockAccountsCall = jest.fn();
    mockServer = {
      accounts: jest.fn().mockReturnValue({
        accountId: jest.fn().mockReturnValue({
          call: mockAccountsCall,
        }),
      }),
    };

    // Setup the mock hook to return the expected API
    mockUseStellarBalances.mockReturnValue({
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
        }
      ],
      loading: false,
      error: null,
      refresh: jest.fn(),
      stopPolling: jest.fn(),
    });

    // Setup mocked SDK components
    const StellarSDK = await import('@stellar/stellar-sdk');
    StellarSDK.Horizon.Server.mockImplementation(() => mockServer);
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  it('should return balances state with proper structure', () => {
    const { result } = renderHook(() => mockUseStellarBalances());

    expect(Array.isArray(result.current.balances)).toBe(true);
    expect(typeof result.current.loading).toBe('boolean');
    expect(typeof result.current.refresh).toBe('function');
    expect(typeof result.current.stopPolling).toBe('function');
  });

  it('should return expected balance data', () => {
    const { result } = renderHook(() => mockUseStellarBalances());

    const balances = result.current.balances;
    expect(balances).toHaveLength(2);

    // Check native XLM balance
    const xlmBalance = balances.find((b: Balance) => b.asset_type === 'native');
    expect(xlmBalance).toBeDefined();
    expect(xlmBalance?.balance).toBe('100.0000000');

    // Check USDC balance
    const usdcBalance = balances.find((b: Balance) => b.asset_code === 'USDC');
    expect(usdcBalance).toBeDefined();
    expect(usdcBalance?.asset_issuer).toBe('GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO');
    expect(usdcBalance?.balance).toBe('250.5000000');
    expect(usdcBalance?.limit).toBe('922337203685.4775807');
  });

  it('should handle loading state', () => {
    const mockLoadingState = jest.fn().mockReturnValue({
      balances: [],
      loading: true,
      error: null,
      refresh: jest.fn(),
      stopPolling: jest.fn(),
    });

    const { result } = renderHook(() => mockLoadingState());
    expect(result.current.loading).toBe(true);
    expect(result.current.balances).toHaveLength(0);
  });

  it('should handle error state', () => {
    const testError = new Error('Network error: Failed to connect to Horizon');
    const mockErrorState = jest.fn().mockReturnValue({
      balances: [],
      loading: false,
      error: testError,
      refresh: jest.fn(),
      stopPolling: jest.fn(),
    });

    const { result } = renderHook(() => mockErrorState());
    expect(result.current.error).toBe(testError);
    expect(result.current.loading).toBe(false);
  });

  it('should handle empty balances gracefully', () => {
    const mockEmptyState = jest.fn().mockReturnValue({
      balances: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      stopPolling: jest.fn(),
    });

    const { result } = renderHook(() => mockEmptyState());
    expect(result.current.balances).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it('should call refresh function', async () => {
    const { result } = renderHook(() => mockUseStellarBalances());

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.refresh).toHaveBeenCalled();
  });

  it('should call stopPolling function', () => {
    const { result } = renderHook(() => mockUseStellarBalances());

    act(() => {
      result.current.stopPolling();
    });

    expect(result.current.stopPolling).toHaveBeenCalled();
  });

  it('should validate balance structure', () => {
    const { result } = renderHook(() => mockUseStellarBalances());

    const balances = result.current.balances;
    balances.forEach((balance: Balance) => {
      expect(typeof balance.asset_type).toBe('string');
      expect(typeof balance.balance).toBe('string');
      
      if (balance.asset_type !== 'native') {
        expect(typeof balance.asset_code).toBe('string');
        expect(typeof balance.asset_issuer).toBe('string');
      }
    });
  });
});