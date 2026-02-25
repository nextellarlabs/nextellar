/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { useOfferBook } from '../../src/templates/default/src/hooks/useOfferBook.js';

// Mock the context provider hook
jest.mock('../../src/templates/default/src/contexts/index', () => ({
  useWalletConfig: jest.fn(),
  WalletProvider: jest.fn(),
}));

// Import the mocked hook to set return values
import { useWalletConfig } from '../../src/templates/default/src/contexts/index.js';

const server = setupServer(
  http.get('*/order_book', ({ request }) => {
    const url = new URL(request.url);
    const buyingCode = url.searchParams.get('buying_asset_code');
    const sellingCode = url.searchParams.get('selling_asset_code');
    const buyingIssuer = url.searchParams.get('buying_asset_issuer');

    // Scenario: Network Error
    if (buyingCode === 'ERROR') {
      return new HttpResponse(null, { status: 500 });
    }

    // Scenario: Empty Orderbook
    if (buyingCode === 'EMPTY') {
      return HttpResponse.json({
        bids: [],
        asks: [],
        base: { asset_type: 'native' },
        counter: { asset_type: 'credit_alphanum4', asset_code: 'EMPTY', asset_issuer: 'ISSUER' }
      });
    }

    // Scenario: Custom/Custom (USDC/BTC)
    if (buyingCode === 'USDC' && sellingCode === 'BTC') {
       // Validate query params for custom assets
       if (buyingIssuer !== 'USDC_ISSUER') {
           return new HttpResponse(null, { status: 400 });
       }
       return HttpResponse.json({
        bids: [{ price: '0.0001', amount: '100', seller: 'A', buying: { code: 'USDC', issuer: 'USDC_ISSUER' }, selling: { code: 'BTC', issuer: 'BTC_ISSUER' } }],
        asks: [{ price: '0.0002', amount: '50', seller: 'B', buying: { code: 'USDC', issuer: 'USDC_ISSUER' }, selling: { code: 'BTC', issuer: 'BTC_ISSUER' } }],
        base: { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'USDC_ISSUER' },
        counter: { asset_type: 'credit_alphanum4', asset_code: 'BTC', asset_issuer: 'BTC_ISSUER' }
      });
    }

    // Default: Native/Custom (XLM/USDC)
    return HttpResponse.json({
      bids: [
        { price: '0.0800000', amount: '100.0000000', seller: 'GA...', buying: { code: 'XLM', issuer: '' }, selling: { code: 'USDC', issuer: 'ISSUER' } },
        { price: '0.0750000', amount: '50.0000000', seller: 'GB...', buying: { code: 'XLM', issuer: '' }, selling: { code: 'USDC', issuer: 'ISSUER' } },
      ],
      asks: [
        { price: '0.0850000', amount: '20.0000000', seller: 'GC...', buying: { code: 'XLM', issuer: '' }, selling: { code: 'USDC', issuer: 'ISSUER' } },
        { price: '0.0900000', amount: '10.0000000', seller: 'GD...', buying: { code: 'XLM', issuer: '' }, selling: { code: 'USDC', issuer: 'ISSUER' } },
      ],
      base: { asset_type: 'native' },
      counter: { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'ISSUER' }
    });
  })
);

beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  jest.clearAllMocks();
});
afterAll(() => server.close());

describe('useOfferBook', () => {
  const mockHorizonUrl = 'https://horizon-testnet.stellar.org';

  beforeEach(() => {
    (useWalletConfig as jest.Mock).mockReturnValue({
      horizonUrl: mockHorizonUrl,
    });
  });

  it('should fetch orderbook for native/custom asset pair', async () => {
    const buying = 'XLM';
    const selling = { code: 'USDC', issuer: 'ISSUER' };

    const { result } = renderHook(() => useOfferBook(buying, selling));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.bids).toHaveLength(2);
    expect(result.current.asks).toHaveLength(2);
    expect(result.current.bids[0].price).toBe('0.0800000');
    expect(result.current.error).toBeNull();
  });

  it('should fetch orderbook for custom/custom asset pair with correct query params', async () => {
    const buying = { code: 'USDC', issuer: 'USDC_ISSUER' };
    const selling = { code: 'BTC', issuer: 'BTC_ISSUER' };

    const { result } = renderHook(() => useOfferBook(buying, selling));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.bids).toHaveLength(1);
    expect(result.current.asks).toHaveLength(1);
    expect(result.current.bids[0].buying).toEqual(buying); // Verify mapping
  });

  it('should return correct response shape', async () => {
    const buying = 'XLM';
    const selling = { code: 'USDC', issuer: 'ISSUER' };

    const { result } = renderHook(() => useOfferBook(buying, selling));

    await waitFor(() => expect(result.current.loading).toBe(false));

    const bid = result.current.bids[0];
    expect(bid).toHaveProperty('price');
    expect(bid).toHaveProperty('amount');
    expect(bid).toHaveProperty('seller');
    expect(bid).toHaveProperty('buying', buying);
    expect(bid).toHaveProperty('selling', selling);
  });

  it('should handle empty orderbook gracefully', async () => {
    const buying = { code: 'EMPTY', issuer: 'ISSUER' };
    const selling = { code: 'USDC', issuer: 'ISSUER' };

    const { result } = renderHook(() => useOfferBook(buying, selling));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.bids).toEqual([]);
    expect(result.current.asks).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('should handle network error', async () => {
    const buying = { code: 'ERROR', issuer: 'ISSUER' };
    const selling = { code: 'USDC', issuer: 'ISSUER' };

    const { result } = renderHook(() => useOfferBook(buying, selling));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.bids).toEqual([]);
  });

  it('should poll for updates', async () => {
    jest.useFakeTimers();
    const buying = 'XLM';
    const selling = { code: 'USDC', issuer: 'ISSUER' };

    const fetchSpy = jest.spyOn(global, 'fetch');

    const { unmount } = renderHook(() => useOfferBook(buying, selling, { pollIntervalMs: 1000 }));

    // First fetch happens on mount
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    // Fast-forward time
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    
    unmount();
    jest.useRealTimers();
    fetchSpy.mockRestore();
  });
});
