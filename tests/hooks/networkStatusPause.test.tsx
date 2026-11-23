/**
 * @jest-environment jsdom
 *
 * Polling hooks pause while their backend is reported down by
 * NetworkStatusProvider, and resume when it recovers (#1502).
 *
 * The real hooks run; only the Stellar SDK and `fetch` are mocked. The
 * network status is injected through `NetworkStatusContext` so each test
 * controls exactly when a backend flips down/up.
 */
import { jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  useFakeHookTimers,
  useRealHookTimers,
  flush,
  advanceAndFlush,
} from "../helpers/fake-timers.js";
import {
  HORIZON_TESTNET_URL as HORIZON_URL,
  USDC,
  BTC,
} from "../helpers/fixtures";

// ── SDK mock: just enough surface for the four hooks ─────────────────────────

const accountCall = jest.fn<() => Promise<unknown>>();
const getEvents = jest.fn<() => Promise<unknown>>();
const closeStream = jest.fn();
const openStream = jest.fn((_handlers: unknown) => closeStream);

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => ({
      accounts: () => ({ accountId: () => ({ call: accountCall }) }),
      payments: () => ({
        forAccount: () => ({ cursor: () => ({ stream: openStream }) }),
      }),
      operations: () => ({
        forAccount: () => ({ cursor: () => ({ stream: openStream }) }),
      }),
    })),
  },
  rpc: { Server: jest.fn(() => ({ getEvents })) },
}));

const { NetworkStatusContext, deriveNetworkStatus } =
  await import("../../src/templates/default/src/contexts/NetworkStatusContext");
const { useOfferBook } =
  await import("../../src/templates/default/src/hooks/useOfferBook.js");
const { useStellarBalances } =
  await import("../../src/templates/default/src/hooks/useStellarBalances");
const { useHorizonStreaming } =
  await import("../../src/templates/default/src/hooks/useHorizonStreaming");
const { useSorobanEvents } =
  await import("../../src/templates/default/src/hooks/useSorobanEvents.js");

// ── Controllable network status ──────────────────────────────────────────────

type Service = "up" | "down";
let horizonStatus: Service = "up";
let rpcStatus: Service = "up";

const wrapper = ({ children }: { children: ReactNode }) => (
  <NetworkStatusContext.Provider
    value={{
      status: deriveNetworkStatus(horizonStatus, rpcStatus),
      horizon: horizonStatus,
      rpc: rpcStatus,
      lastCheckedAt: 1,
    }}
  >
    {children}
  </NetworkStatusContext.Provider>
);

const ADDRESS = "GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ";
const CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

describe("polling hooks pause while their backend is down (#1502)", () => {
  let fetchMock: jest.Mock<typeof fetch>;

  beforeEach(() => {
    useFakeHookTimers();
    jest.clearAllMocks();
    horizonStatus = "up";
    rpcStatus = "up";

    fetchMock = jest.fn<typeof fetch>(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ bids: [], asks: [] }),
        }) as Response,
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    accountCall.mockResolvedValue({ balances: [] });
    getEvents.mockResolvedValue({ events: [], cursor: "c1" });
  });

  afterEach(() => {
    useRealHookTimers();
  });

  describe("useOfferBook (Horizon)", () => {
    const render = () =>
      renderHook(
        () =>
          useOfferBook(USDC, BTC, {
            horizonUrl: HORIZON_URL,
            pollIntervalMs: 1000,
          }),
        {
          wrapper,
        },
      );

    it("polls normally while Horizon is up", async () => {
      render();
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await advanceAndFlush(3000);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it("stops polling when Horizon goes down and resumes when it recovers", async () => {
      const { rerender } = render();
      await flush();
      await advanceAndFlush(1000);
      const callsBeforePause = fetchMock.mock.calls.length;

      horizonStatus = "down";
      rerender();
      await advanceAndFlush(5000);
      expect(fetchMock.mock.calls.length).toBe(callsBeforePause);

      horizonStatus = "up";
      rerender();
      await flush();
      expect(fetchMock.mock.calls.length).toBe(callsBeforePause + 1); // catch-up fetch
      await advanceAndFlush(1000);
      expect(fetchMock.mock.calls.length).toBe(callsBeforePause + 2); // polling is back
    });

    it("does not fetch at all when mounted while Horizon is already down", async () => {
      horizonStatus = "down";
      render();
      await flush();
      await advanceAndFlush(5000);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("keeps polling when only Soroban RPC is down", async () => {
      rpcStatus = "down";
      render();
      await flush();
      await advanceAndFlush(2000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe("useStellarBalances (Horizon)", () => {
    const render = () =>
      renderHook(
        () =>
          useStellarBalances(ADDRESS, {
            horizonUrl: HORIZON_URL,
            pollIntervalMs: 5000,
          }),
        { wrapper },
      );

    it("stops polling when Horizon goes down and resumes when it recovers", async () => {
      const { rerender } = render();
      await flush();
      expect(accountCall).toHaveBeenCalledTimes(1);
      await advanceAndFlush(5000);
      expect(accountCall).toHaveBeenCalledTimes(2);

      horizonStatus = "down";
      rerender();
      await advanceAndFlush(30_000);
      expect(accountCall).toHaveBeenCalledTimes(2);

      horizonStatus = "up";
      rerender();
      await flush();
      expect(accountCall).toHaveBeenCalledTimes(3); // refreshed on recovery
      await advanceAndFlush(5000);
      expect(accountCall).toHaveBeenCalledTimes(4);
    });

    it("does not fetch when mounted while Horizon is already down", async () => {
      horizonStatus = "down";
      render();
      await flush();
      await advanceAndFlush(30_000);
      expect(accountCall).not.toHaveBeenCalled();
    });

    it("keeps the last known balances while paused", async () => {
      accountCall.mockResolvedValue({
        balances: [{ asset_type: "native", balance: "10.0000000" }],
      });
      const { result, rerender } = render();
      await flush();
      expect(result.current.balances).toHaveLength(1);

      horizonStatus = "down";
      rerender();
      await advanceAndFlush(30_000);
      expect(result.current.balances).toHaveLength(1);
      expect(result.current.error).toBeNull();
    });
  });

  describe("useHorizonStreaming (Horizon)", () => {
    const render = () =>
      renderHook(
        () =>
          useHorizonStreaming(ADDRESS, () => {}, { horizonUrl: HORIZON_URL }),
        {
          wrapper,
        },
      );

    it("closes the stream when Horizon goes down and reconnects on recovery", async () => {
      const { rerender } = render();
      await flush();
      expect(openStream).toHaveBeenCalledTimes(1);
      expect(closeStream).not.toHaveBeenCalled();

      horizonStatus = "down";
      rerender();
      await flush();
      expect(closeStream).toHaveBeenCalledTimes(1);

      horizonStatus = "up";
      rerender();
      await flush();
      expect(openStream).toHaveBeenCalledTimes(2);
    });

    it("does not open a stream when mounted while Horizon is already down", async () => {
      horizonStatus = "down";
      const { result } = render();
      await flush();
      expect(openStream).not.toHaveBeenCalled();
      expect(result.current.streaming).toBe(false);
      expect(result.current.polling).toBe(false);
    });

    it("stops the polling fallback while Horizon is down", async () => {
      const onUpdate = jest.fn();
      const { rerender } = renderHook(
        () =>
          useHorizonStreaming(ADDRESS, onUpdate, {
            horizonUrl: HORIZON_URL,
            pollIntervalMs: 5000,
          }),
        { wrapper },
      );
      await flush();
      // Drop the stream to force the polling fallback.
      const handlers = openStream.mock.calls[0][0] as { onerror: () => void };
      act(() => handlers.onerror());
      await advanceAndFlush(5000);
      expect(onUpdate).toHaveBeenCalledTimes(1);

      horizonStatus = "down";
      rerender();
      await advanceAndFlush(60_000);
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe("useSorobanEvents (Soroban RPC)", () => {
    const render = () =>
      renderHook(
        () =>
          useSorobanEvents(CONTRACT, {
            sorobanRpc: "https://rpc.test",
            pollIntervalMs: 1000,
          }),
        {
          wrapper,
        },
      );

    it("stops polling when RPC goes down and catches up when it recovers", async () => {
      const { rerender } = render();
      await flush();
      expect(getEvents).toHaveBeenCalledTimes(1);
      await advanceAndFlush(1000);
      expect(getEvents).toHaveBeenCalledTimes(2);

      rpcStatus = "down";
      rerender();
      await advanceAndFlush(30_000);
      expect(getEvents).toHaveBeenCalledTimes(2);

      rpcStatus = "up";
      rerender();
      await flush();
      expect(getEvents).toHaveBeenCalledTimes(3); // catch-up fetch
      await advanceAndFlush(1000);
      expect(getEvents).toHaveBeenCalledTimes(4); // polling is back
    });

    it("does not fetch when mounted while RPC is already down, then fetches on recovery", async () => {
      rpcStatus = "down";
      const { rerender } = render();
      await flush();
      await advanceAndFlush(30_000);
      expect(getEvents).not.toHaveBeenCalled();

      rpcStatus = "up";
      rerender();
      await flush();
      expect(getEvents).toHaveBeenCalledTimes(1);
    });

    it("keeps polling when only Horizon is down", async () => {
      horizonStatus = "down";
      render();
      await flush();
      await advanceAndFlush(1000);
      expect(getEvents).toHaveBeenCalledTimes(2);
    });
  });
});
