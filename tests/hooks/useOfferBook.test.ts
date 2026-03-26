/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react';

import { useOfferBook } from '../../src/templates/js-template/src/hooks/useOfferBook.js';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';

const USDC = { code: 'USDC', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' };
const BTC = { code: 'BTC', issuer: 'GDXTJEK4JZNSTNQAWA53RZNS2GIKTDRPEUWDXELFMKU52XNECNVDVUTD' };

function makeOrderbookResponse(bids: any[] = [], asks: any[] = []) {
  return { bids, asks };
}

const defaultResponse = makeOrderbookResponse(
  [
    { price: '0.5000000', amount: '100.0000000' },
    { price: '0.4900000', amount: '200.0000000' },
  ],
  [
    { price: '0.5100000', amount: '150.0000000' },
    { price: '0.5200000', amount: '250.0000000' },
  ],
);

let mockFetch: jest.Mock;
let capturedUrls: string[];

describe('useOfferBook', () => {
  beforeEach(() => {
    capturedUrls = [];
    mockFetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      capturedUrls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => defaultResponse,
      };
    });
    globalThis.fetch = mockFetch as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function flush() {
    await act(async () => {});
  }

  it('fetches bids and asks for a native/custom pair (XLM/USDC)', async () => {
    const { result } = renderHook(() =>
      useOfferBook('XLM', USDC, { horizonUrl: HORIZON_URL }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.bids).toHaveLength(2);
    expect(result.current.asks).toHaveLength(2);
    expect(result.current.bids[0].price).toBe('0.5000000');
    expect(result.current.asks[0].price).toBe('0.5100000');
    expect(result.current.error).toBeNull();
  });

  it('fetches bids and asks for a custom/custom pair (USDC/BTC)', async () => {
    const { result } = renderHook(() =>
      useOfferBook(USDC, BTC, { horizonUrl: HORIZON_URL }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.bids).toHaveLength(2);
    expect(result.current.asks).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('sends correct query params for native and custom assets', async () => {
    const { result } = renderHook(() =>
      useOfferBook('XLM', USDC, { horizonUrl: HORIZON_URL, limit: 10 }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(capturedUrls.length).toBeGreaterThanOrEqual(1);
    const url = new URL(capturedUrls[0]);
    expect(url.searchParams.get('buying_asset_type')).toBe('native');
    expect(url.searchParams.get('selling_asset_type')).toBe('credit_alphanum4');
    expect(url.searchParams.get('selling_asset_code')).toBe('USDC');
    expect(url.searchParams.get('selling_asset_issuer')).toBe(USDC.issuer);
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('handles an empty orderbook', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeOrderbookResponse([], []),
    });

    const { result } = renderHook(() =>
      useOfferBook('XLM', USDC, { horizonUrl: HORIZON_URL }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.bids).toHaveLength(0);
    expect(result.current.asks).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it('surfaces network errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'Internal Server Error' }),
    });

    const { result } = renderHook(() =>
      useOfferBook('XLM', USDC, { horizonUrl: HORIZON_URL }),
    );

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));

    expect(result.current.error!.message).toContain('500');
  });

  it('supports polling when pollIntervalMs is set', async () => {
    jest.useFakeTimers();

    const { result } = renderHook(() =>
      useOfferBook('XLM', USDC, { horizonUrl: HORIZON_URL, pollIntervalMs: 5000 }),
    );

    // Wait for initial fetch
    await flush();
    const initialCount = mockFetch.mock.calls.length;

    // Advance past one poll interval
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await flush();

    expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCount);

    // Stop polling
    act(() => {
      result.current.stopPolling();
    });

    const countAfterStop = mockFetch.mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(10000);
    });

    expect(mockFetch.mock.calls.length).toBe(countAfterStop);

    jest.useRealTimers();
  });
});
