/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react';

// Setup TextEncoder/TextDecoder for this test file
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock the Stellar SDK module entirely since it's not a dependency of the main CLI
jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn(),
  },
}));

// Import from template directory since hooks should only exist there
const { useStellarBalances } = require('../../src/templates/ts-template/src/hooks/useStellarBalances');

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

describe('useStellarBalances (Template Hook)', () => {
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

  it('should return initial state correctly', () => {
    const { result } = renderHook(() => useStellarBalances());

    expect(result.current.balances).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.refresh).toBe('function');
    expect(typeof result.current.stopPolling).toBe('function');
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
    expect(result.current.error).toBeNull();
  });

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

  it('should use custom Horizon URL', async () => {
    const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
    const customHorizonUrl = 'https://horizon.stellar.org';
    mockAccountsCall.mockResolvedValue(mockAccountData);

    renderHook(() =>
      useStellarBalances(publicKey, { horizonUrl: customHorizonUrl })
    );

    expect(require('@stellar/stellar-sdk').Horizon.Server).toHaveBeenCalledWith(customHorizonUrl);
  });
});