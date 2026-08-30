/**
 * @jest-environment jsdom
 *
 * Unit tests for the real `useOfferBook` template hook (issue #821).
 *
 * The pre-existing `tests/hooks/useOfferBook.test.ts` targets the
 * `js-template` copy of the hook and currently fails to run at all — Jest
 * loads that `.js` file as CJS and chokes on its `import` statements. This
 * suite targets the TypeScript hook under `src/templates/default`, which the
 * Babel transform handles, so the behaviour is actually exercised.
 *
 * The hook talks to Horizon over `fetch` rather than the Stellar SDK, so only
 * `globalThis.fetch` is stubbed here.
 *
 * Covers the issue's acceptance criteria:
 *   - fetching bids and asks
 *   - handling an empty book
 *   - verifying subscription cleanup (the poll interval is cleared on unmount,
 *     on dependency change, and via stopPolling)
 */

import { jest } from "@jest/globals";
import { renderHook, act, waitFor } from "@testing-library/react";

import {
  useFakeHookTimers,
  useRealHookTimers,
  flush,
  advanceAndFlush,
} from "../helpers/fake-timers.js";

const { useOfferBook } =
  await import("../../src/templates/default/src/hooks/useOfferBook.js");

// ── Fixtures ────────────────────────────────────────────────────────────────

const HORIZON_URL = "https://horizon-testnet.stellar.org";

const USDC = {
  code: "USDC",
  issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};
const BTC = {
  code: "BTC",
  issuer: "GDXTJEK4JZNSTNQAWA53RZNS2GIKTDRPEUWDXELFMKU52XNECNVDVUTD",
};

const BIDS = [
  { price: "0.5000000", amount: "100.0000000" },
  { price: "0.4900000", amount: "200.0000000" },
];
const ASKS = [
  { price: "0.5100000", amount: "150.0000000" },
  { price: "0.5200000", amount: "250.0000000" },
];

/** A Horizon orderbook entry; `seller` is present on some responses only. */
type OrderbookEntry = { price: string; amount: string; seller?: string };

// Typed loosely for the same reason as the SDK mocks elsewhere: a bare
// `jest.fn()` from '@jest/globals' infers `never` parameters, which would make
// every mockResolvedValue below a type error.
type FetchMock = jest.Mock<(...args: never[]) => Promise<unknown>>;

let mockFetch: FetchMock;
let requestedUrls: string[];

/** Stub `fetch` with a fixed orderbook payload. */
function stubOrderbook(
  bids: OrderbookEntry[] = BIDS,
  asks: OrderbookEntry[] = ASKS,
) {
  mockFetch.mockImplementation((async (input: unknown) => {
    requestedUrls.push(String(input));
    return { ok: true, status: 200, json: async () => ({ bids, asks }) };
  }) as never);
}

/**
 * Timers pending right now, including ones React and jsdom keep for their own
 * bookkeeping.
 *
 * The absolute number is not meaningful on its own — the environment holds a
 * timer of its own from the first render onwards, and it is not released on
 * unmount — so the cleanup tests below never assert on it directly. They
 * compare it before and after an action instead, which isolates the hook's own
 * interval from that floor.
 */
function timerCount(): number {
  return jest.getTimerCount();
}

describe("useOfferBook (real template hook)", () => {
  beforeEach(() => {
    requestedUrls = [];
    mockFetch = jest.fn() as FetchMock;
    globalThis.fetch = mockFetch as never;
    stubOrderbook();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Fetching bids and asks ────────────────────────────────────────────────

  describe("fetching bids and asks", () => {
    it("loads bids and asks for a native/custom pair", async () => {
      const { result } = renderHook(() =>
        useOfferBook("XLM", USDC, { horizonUrl: HORIZON_URL }),
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.error).toBeNull();
      expect(result.current.bids).toHaveLength(2);
      expect(result.current.asks).toHaveLength(2);

      // Each offer carries the price/amount from Horizon plus the pair it
      // belongs to, so a caller holding a single offer knows its market.
      expect(result.current.bids[0]).toEqual({
        price: "0.5000000",
        amount: "100.0000000",
        seller: "",
        buying: "XLM",
        selling: USDC,
      });
      expect(result.current.asks[0]).toMatchObject({ price: "0.5100000" });
    });

    it("loads a custom/custom pair", async () => {
      const { result } = renderHook(() =>
        useOfferBook(USDC, BTC, { horizonUrl: HORIZON_URL }),
      );

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.bids[0]).toMatchObject({
        buying: USDC,
        selling: BTC,
      });
    });

    it("encodes native and credit assets into the query correctly", async () => {
      const { result } = renderHook(() =>
        useOfferBook("XLM", USDC, { horizonUrl: HORIZON_URL, limit: 5 }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(requestedUrls).toHaveLength(1);
      const url = new URL(requestedUrls[0]);

      expect(url.origin + url.pathname).toBe(`${HORIZON_URL}/order_book`);
      expect(url.searchParams.get("buying_asset_type")).toBe("native");
      // A native asset carries no code/issuer.
      expect(url.searchParams.get("buying_asset_code")).toBeNull();
      expect(url.searchParams.get("selling_asset_type")).toBe(
        "credit_alphanum4",
      );
      expect(url.searchParams.get("selling_asset_code")).toBe(USDC.code);
      expect(url.searchParams.get("selling_asset_issuer")).toBe(USDC.issuer);
      expect(url.searchParams.get("limit")).toBe("5");
    });

    it("preserves the seller when Horizon supplies one", async () => {
      const seller = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
      stubOrderbook([{ price: "1.0", amount: "5.0", seller }], []);

      const { result } = renderHook(() =>
        useOfferBook("XLM", USDC, { horizonUrl: HORIZON_URL }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.bids[0].seller).toBe(seller);
    });

    it("surfaces a non-OK Horizon response as an error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({}),
      });

      const { result } = renderHook(() =>
        useOfferBook("XLM", USDC, { horizonUrl: HORIZON_URL }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toContain("429");
    });

    it("clears a previous error once a retry succeeds", async () => {
      mockFetch.mockRejectedValueOnce(new Error("network down"));

      const { result } = renderHook(() =>
        useOfferBook("XLM", USDC, { horizonUrl: HORIZON_URL }),
      );
      await waitFor(() => expect(result.current.error).not.toBeNull());

      stubOrderbook();
      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.bids).toHaveLength(2);
    });
  });

  // ── Empty book ────────────────────────────────────────────────────────────

  describe("an empty order book", () => {
    it("yields empty bid and ask arrays without erroring", async () => {
      stubOrderbook([], []);

      const { result } = renderHook(() =>
        useOfferBook("XLM", USDC, { horizonUrl: HORIZON_URL }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.bids).toEqual([]);
      expect(result.current.asks).toEqual([]);
      // An empty book is a valid market state, not a failure.
      expect(result.current.error).toBeNull();
    });

    it("treats missing bids/asks keys as empty rather than crashing", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const { result } = renderHook(() =>
        useOfferBook("XLM", USDC, { horizonUrl: HORIZON_URL }),
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.bids).toEqual([]);
      expect(result.current.asks).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it("replaces a populated book with an empty one", async () => {
      const { result } = renderHook(() =>
        useOfferBook("XLM", USDC, { horizonUrl: HORIZON_URL }),
      );
      await waitFor(() => expect(result.current.bids).toHaveLength(2));

      // The market empties out between polls; stale offers must not linger.
      stubOrderbook([], []);
      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.bids).toEqual([]);
      expect(result.current.asks).toEqual([]);
    });
  });

  // ── Subscription cleanup ──────────────────────────────────────────────────

  describe("subscription cleanup", () => {
    beforeEach(() => {
      useFakeHookTimers();
    });

    afterEach(() => {
      useRealHookTimers();
    });

    it("registers no interval when polling is disabled", async () => {
      const { unmount } = renderHook(() =>
        useOfferBook("XLM", USDC, { horizonUrl: HORIZON_URL }),
      );
      await flush();

      // Nothing to tear down, so unmounting releases no timer.
      const before = timerCount();
      unmount();
      expect(timerCount()).toBe(before);

      await advanceAndFlush(5000);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("polls on the configured interval", async () => {
      const { result } = renderHook(() =>
        useOfferBook("XLM", USDC, {
          horizonUrl: HORIZON_URL,
          pollIntervalMs: 1000,
        }),
      );
      await flush();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await advanceAndFlush(1000);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      await advanceAndFlush(1000);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.current.error).toBeNull();
    });

    it("clears the interval on unmount and stops fetching", async () => {
      const { unmount } = renderHook(() =>
        useOfferBook("XLM", USDC, {
          horizonUrl: HORIZON_URL,
          pollIntervalMs: 1000,
        }),
      );
      await flush();

      await advanceAndFlush(1000);
      const callsBeforeUnmount = mockFetch.mock.calls.length;
      const beforeUnmount = timerCount();

      unmount();

      // The effect's cleanup must clear the interval, or the hook keeps
      // polling Horizon for the lifetime of the page.
      expect(timerCount()).toBe(beforeUnmount - 1);

      await advanceAndFlush(5000);
      expect(mockFetch).toHaveBeenCalledTimes(callsBeforeUnmount);
    });

    it("stopPolling() halts further requests while mounted", async () => {
      const { result } = renderHook(() =>
        useOfferBook("XLM", USDC, {
          horizonUrl: HORIZON_URL,
          pollIntervalMs: 1000,
        }),
      );
      await flush();
      await advanceAndFlush(1000);

      const callsBeforeStop = mockFetch.mock.calls.length;
      const beforeStop = timerCount();
      act(() => {
        result.current.stopPolling();
      });

      expect(timerCount()).toBe(beforeStop - 1);
      await advanceAndFlush(5000);
      expect(mockFetch).toHaveBeenCalledTimes(callsBeforeStop);

      // Manual refresh still works — stopPolling ends the schedule, not the hook.
      await act(async () => {
        await result.current.refresh();
      });
      expect(mockFetch).toHaveBeenCalledTimes(callsBeforeStop + 1);
    });

    it("does not leave a second interval behind when the pair changes", async () => {
      const { rerender, unmount } = renderHook(
        ({ selling }) =>
          useOfferBook("XLM", selling, {
            horizonUrl: HORIZON_URL,
            pollIntervalMs: 1000,
          }),
        { initialProps: { selling: USDC } },
      );
      await flush();

      rerender({ selling: BTC });
      await flush();

      // Re-running the effect must tear down the previous interval. Counting
      // requests rather than timers is what actually pins this down: a stale
      // poller left behind would fire alongside the new one, so a single tick
      // producing two requests is the leak this guards against.
      const callsAfterSwitch = mockFetch.mock.calls.length;
      await advanceAndFlush(1000);
      expect(mockFetch).toHaveBeenCalledTimes(callsAfterSwitch + 1);

      // And the surviving poller queries the new pair, not the old one.
      expect(requestedUrls.at(-1)).toContain(BTC.issuer);

      const beforeUnmount = timerCount();
      unmount();
      expect(timerCount()).toBe(beforeUnmount - 1);
    });

    it("stops polling when the interval is turned off mid-flight", async () => {
      const { rerender } = renderHook(
        ({ pollIntervalMs }) =>
          useOfferBook("XLM", USDC, {
            horizonUrl: HORIZON_URL,
            pollIntervalMs,
          }),
        { initialProps: { pollIntervalMs: 1000 as number | null } },
      );
      await flush();

      rerender({ pollIntervalMs: null });
      await flush();

      // Turning polling off must clear the existing interval, so no further
      // request is made no matter how far the clock advances.
      const calls = mockFetch.mock.calls.length;
      await advanceAndFlush(5000);
      expect(mockFetch).toHaveBeenCalledTimes(calls);
    });
  });
});
