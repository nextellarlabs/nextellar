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
const { useTransactionHistory } = require('../../src/templates/ts-template/src/hooks/useTransactionHistory');

describe('useTransactionHistory (Template Hook)', () => {
  let mockServer: any;
  let mockOperationsCall: jest.Mock;
  let mockPaymentsCall: jest.Mock;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock console methods to avoid test noise
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    // Create mock server with chained methods
    mockOperationsCall = jest.fn();
    mockPaymentsCall = jest.fn();
    
    mockServer = {
      operations: jest.fn().mockReturnValue({
        forAccount: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              cursor: jest.fn().mockReturnValue({
                call: mockOperationsCall,
              }),
              call: mockOperationsCall,
            }),
          }),
        }),
      }),
      payments: jest.fn().mockReturnValue({
        forAccount: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              cursor: jest.fn().mockReturnValue({
                call: mockPaymentsCall,
              }),
              call: mockPaymentsCall,
            }),
          }),
        }),
      }),
    };

    require('@stellar/stellar-sdk').Horizon.Server.mockImplementation(() => mockServer);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  const mockOperationsData = {
    records: [
      {
        id: '12345',
        type_i: 1,
        type: 'payment',
        created_at: '2023-12-01T12:00:00Z',
        amount: '100.0000000',
        paging_token: 'token_1',
      },
      {
        id: '12346',
        type_i: 0,
        type: 'create_account',
        created_at: '2023-12-01T11:00:00Z',
        paging_token: 'token_2',
      },
    ],
  };

  const mockPaymentsData = {
    records: [
      {
        id: '12345',
        type_i: 1,
        type: 'payment',
        created_at: '2023-12-01T12:00:00Z',
        amount: '100.0000000',
        paging_token: 'token_1',
      },
    ],
  };

  const mockSecondPageData = {
    records: [
      {
        id: '12347',
        type_i: 1,
        type: 'payment',
        created_at: '2023-12-01T10:00:00Z',
        amount: '50.0000000',
        paging_token: 'token_3',
      },
    ],
  };

  it('should return initial state correctly', () => {
    const { result } = renderHook(() => useTransactionHistory());

    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(true);
    expect(typeof result.current.fetchNextPage).toBe('function');
    expect(typeof result.current.refresh).toBe('function');
  });

  it('should fetch operations successfully with valid publicKey', async () => {
    const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
    mockOperationsCall.mockResolvedValueOnce(mockOperationsData);

    const { result } = renderHook(() => useTransactionHistory(publicKey, { type: 'operations' }));

    // Should start loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0]).toEqual(mockOperationsData.records[0]);
    expect(result.current.items[1]).toEqual(mockOperationsData.records[1]);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(true);
  });

  it('should fetch payments successfully with valid publicKey', async () => {
    const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
    mockPaymentsCall.mockResolvedValueOnce(mockPaymentsData);

    const { result } = renderHook(() => useTransactionHistory(publicKey, { type: 'payments' }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toEqual(mockPaymentsData.records[0]);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(true);
  });

  it('should handle account not found (404) gracefully', async () => {
    const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
    const notFoundError = {
      response: { status: 404 },
      name: 'NotFoundError',
    };
    mockOperationsCall.mockRejectedValueOnce(notFoundError);

    const { result } = renderHook(() => useTransactionHistory(publicKey));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(false);
  });

  it('should handle network errors appropriately', async () => {
    const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
    const networkError = {
      message: 'Network fetch failed',
      response: { status: 500 },
    };
    mockOperationsCall.mockRejectedValueOnce(networkError);

    const { result } = renderHook(() => useTransactionHistory(publicKey));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message).toContain('Network error');
  });

  it('should fetch next page successfully', async () => {
    const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
    
    // Mock first page
    mockOperationsCall.mockResolvedValueOnce(mockOperationsData);

    const { result } = renderHook(() => useTransactionHistory(publicKey));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.hasMore).toBe(true);

    // Mock second page
    mockOperationsCall.mockResolvedValueOnce(mockSecondPageData);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(3);
    expect(result.current.items[2]).toEqual(mockSecondPageData.records[0]);
  });

  it('should refresh and replace items', async () => {
    const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
    
    // Mock initial data
    mockOperationsCall.mockResolvedValueOnce(mockOperationsData);

    const { result } = renderHook(() => useTransactionHistory(publicKey));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);

    // Mock refreshed data (different items)
    const refreshedData = {
      records: [
        {
          id: '99999',
          type_i: 2,
          type: 'manage_offer',
          created_at: '2023-12-02T12:00:00Z',
          paging_token: 'token_refresh',
        },
      ],
    };
    mockOperationsCall.mockResolvedValueOnce(refreshedData);

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should replace items, not append
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toEqual(refreshedData.records[0]);
  });

  it('should handle empty publicKey by clearing state', async () => {
    const { result } = renderHook(() => useTransactionHistory(null));

    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(true);
  });

  it('should handle invalid publicKey format', async () => {
    const invalidPublicKey = 'invalid_key';
    
    const { result } = renderHook(() => useTransactionHistory(invalidPublicKey));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message).toContain('Invalid Stellar public key format');
  });

  it('should use custom Horizon URL', async () => {
    const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
    const customHorizonUrl = 'https://horizon.stellar.org';
    mockOperationsCall.mockResolvedValue(mockOperationsData);

    renderHook(() =>
      useTransactionHistory(publicKey, { horizonUrl: customHorizonUrl })
    );

    expect(require('@stellar/stellar-sdk').Horizon.Server).toHaveBeenCalledWith(customHorizonUrl);
  });

  it('should respect custom page size', async () => {
    const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
    const customPageSize = 5;
    mockOperationsCall.mockResolvedValue(mockOperationsData);

    const { result } = renderHook(() =>
      useTransactionHistory(publicKey, { pageSize: customPageSize })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Verify the limit was called with custom page size
    expect(mockServer.operations().forAccount().order().limit).toHaveBeenCalledWith(customPageSize);
  });

  it('should handle memory management for large datasets', async () => {
    const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
    
    // Create a large dataset that exceeds MAX_ITEMS_IN_MEMORY (1000)
    const createLargeDataset = (startId: number, count: number) => ({
      records: Array.from({ length: count }, (_, i) => ({
        id: `${startId + i}`,
        type_i: 1,
        type: 'payment',
        created_at: '2023-12-01T12:00:00Z',
        amount: '10.0000000',
        paging_token: `token_${startId + i}`,
      })),
    });

    // Mock multiple pages of large data
    const firstPage = createLargeDataset(1, 600);
    const secondPage = createLargeDataset(601, 500); // This will exceed 1000 total
    
    mockOperationsCall
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);

    const { result } = renderHook(() => useTransactionHistory(publicKey));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(600);

    // Fetch next page which should trigger memory management
    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should be trimmed to MAX_ITEMS_IN_MEMORY (1000)
    expect(result.current.items).toHaveLength(1000);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Transaction history trimmed to 1000 items to prevent excessive memory usage'
    );
  });

  it('should handle hasMore correctly when no more items', async () => {
    const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
    
    // Mock data with no paging token (indicating no more items)
    const lastPageData = {
      records: [
        {
          id: '12345',
          type_i: 1,
          type: 'payment',
          created_at: '2023-12-01T12:00:00Z',
          amount: '100.0000000',
          paging_token: null, // No next page
        },
      ],
    };
    
    mockOperationsCall.mockResolvedValueOnce(lastPageData);

    const { result } = renderHook(() => useTransactionHistory(publicKey));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasMore).toBe(false);
  });

  it('should prevent duplicate requests', async () => {
    const publicKey = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
    
    // Mock slow response
    mockOperationsCall.mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve(mockOperationsData), 100))
    );

    const { result } = renderHook(() => useTransactionHistory(publicKey));

    // Trigger multiple refresh calls quickly
    act(() => {
      result.current.refresh();
      result.current.refresh();
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should only make one call despite multiple refresh attempts
    expect(mockOperationsCall).toHaveBeenCalledTimes(1);
  });

  it('should reset state when publicKey changes', async () => {
    const publicKey1 = 'GCKFBEIYTKP2NM3BZXBIQXSJBEM3NTWGCAPXFQBHGTHZOO';
    const publicKey2 = 'GDQJUTQYK2MQX2VGDR2FYWLIYAQIEGXTQVTFEMGH2BEWFG4BRUY4XBKT';
    
    mockOperationsCall.mockResolvedValue(mockOperationsData);

    const { result, rerender } = renderHook(
      ({ publicKey }) => useTransactionHistory(publicKey),
      { initialProps: { publicKey: publicKey1 } }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);

    // Change publicKey
    mockOperationsCall.mockResolvedValue(mockPaymentsData);
    rerender({ publicKey: publicKey2 });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should have new items from the new account
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toEqual(mockPaymentsData.records[0]);
  });
});