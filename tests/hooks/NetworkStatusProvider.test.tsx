/**
 * @jest-environment jsdom
 *
 * NetworkStatusProvider (#1502): polls Horizon + Soroban RPC health with
 * backoff and exposes the result through context. `fetch` is mocked and time
 * is faked, so no real network call or real wait happens.
 */
import { jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";

const WALLET_PATH = "../../src/templates/default/src/contexts/WalletProvider";
let walletConfig: { horizonUrl: string; sorobanUrl: string } | undefined;

// The provider only needs `useWalletConfig`; skip loading the real wallet stack.
await jest.unstable_mockModule(WALLET_PATH, () => ({
  useWalletConfig: () => walletConfig,
}));

const { NetworkStatusProvider } =
  await import("../../src/templates/default/src/contexts/NetworkStatusProvider");
const { useNetworkStatus, useNetworkPaused } =
  await import("../../src/templates/default/src/contexts/NetworkStatusContext");

const HORIZON = "https://horizon.test";
const RPC = "https://rpc.test";

const HEALTHY_MS = 30_000;
const BASE_MS = 1_000;
const MAX_MS = 8_000;

// Both health endpoints are driven by these flags; tests flip them mid-run.
let horizonUp = true;
let rpcUp = true;
let fetchMock: jest.Mock<typeof fetch>;

const horizonCalls = () =>
  fetchMock.mock.calls.filter(([url]) => url === `${HORIZON}/`).length;
const rpcCalls = () =>
  fetchMock.mock.calls.filter(([url]) => url === RPC).length;

function installFetch() {
  fetchMock = jest.fn<typeof fetch>(async (url) => {
    if (url === `${HORIZON}/`) {
      return {
        ok: horizonUp,
        status: horizonUp ? 200 : 503,
        json: async () => ({}),
      } as Response;
    }
    if (url === RPC) {
      return {
        ok: rpcUp,
        status: rpcUp ? 200 : 503,
        json: async () => ({
          result: { status: rpcUp ? "healthy" : "unhealthy" },
        }),
      } as Response;
    }
    throw new Error(`unexpected url ${String(url)}`);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

const wrapper =
  (props: Record<string, unknown> = {}) =>
  ({ children }: { children: ReactNode }) => (
    <NetworkStatusProvider
      horizonUrl={HORIZON}
      sorobanUrl={RPC}
      healthyIntervalMs={HEALTHY_MS}
      backoffBaseMs={BASE_MS}
      backoffMaxMs={MAX_MS}
      {...props}
    >
      {children}
    </NetworkStatusProvider>
  );

/** Lets the pending probe settle, then runs timers due within `ms`. */
async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

describe("NetworkStatusProvider (#1502)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Jitter spread = 0 so backoff delays are exact.
    jest.spyOn(Math, "random").mockReturnValue(0.5);
    horizonUp = true;
    rpcUp = true;
    walletConfig = undefined;
    installFetch();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe("status", () => {
    it("starts as checking, then reports online when both are healthy", async () => {
      const { result } = renderHook(() => useNetworkStatus(), {
        wrapper: wrapper(),
      });
      expect(result.current).toMatchObject({
        status: "checking",
        horizon: "checking",
        rpc: "checking",
        lastCheckedAt: null,
      });

      await advance(0);
      expect(result.current).toMatchObject({
        status: "online",
        horizon: "up",
        rpc: "up",
      });
      expect(result.current?.lastCheckedAt).not.toBeNull();
    });

    it("reports degraded when only Horizon is down", async () => {
      horizonUp = false;
      const { result } = renderHook(() => useNetworkStatus(), {
        wrapper: wrapper(),
      });
      await advance(0);
      expect(result.current).toMatchObject({
        status: "degraded",
        horizon: "down",
        rpc: "up",
      });
    });

    it("reports degraded when only RPC is down", async () => {
      rpcUp = false;
      const { result } = renderHook(() => useNetworkStatus(), {
        wrapper: wrapper(),
      });
      await advance(0);
      expect(result.current).toMatchObject({
        status: "degraded",
        horizon: "up",
        rpc: "down",
      });
    });

    it("reports offline when both are down", async () => {
      horizonUp = false;
      rpcUp = false;
      const { result } = renderHook(() => useNetworkStatus(), {
        wrapper: wrapper(),
      });
      await advance(0);
      expect(result.current).toMatchObject({
        status: "offline",
        horizon: "down",
        rpc: "down",
      });
    });

    it("treats a network error (rejected fetch) as down", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      const { result } = renderHook(() => useNetworkStatus(), {
        wrapper: wrapper(),
      });
      await advance(0);
      expect(result.current?.status).toBe("offline");
    });

    it("is undefined outside a provider", () => {
      const { result } = renderHook(() => useNetworkStatus());
      expect(result.current).toBeUndefined();
    });
  });

  describe("polling and backoff", () => {
    it("re-probes on the healthy interval while everything is up", async () => {
      renderHook(() => useNetworkStatus(), { wrapper: wrapper() });
      await advance(0);
      expect(horizonCalls()).toBe(1);
      expect(rpcCalls()).toBe(1);

      await advance(HEALTHY_MS - 1);
      expect(horizonCalls()).toBe(1);
      await advance(1);
      expect(horizonCalls()).toBe(2);
      expect(rpcCalls()).toBe(2);
    });

    it("backs off exponentially while failing, up to the cap", async () => {
      horizonUp = false;
      renderHook(() => useNetworkStatus(), { wrapper: wrapper() });
      await advance(0);
      expect(horizonCalls()).toBe(1);

      // Gaps between probes: 1s, 2s, 4s, 8s, then capped at 8s.
      for (const [gap, expected] of [
        [1_000, 2],
        [2_000, 3],
        [4_000, 4],
        [8_000, 5],
        [8_000, 6],
      ] as const) {
        await advance(gap - 1);
        expect(horizonCalls()).toBe(expected - 1);
        await advance(1);
        expect(horizonCalls()).toBe(expected);
      }
    });

    it("recovers: flips back to online and returns to the healthy interval", async () => {
      horizonUp = false;
      rpcUp = false;
      const { result } = renderHook(() => useNetworkStatus(), {
        wrapper: wrapper(),
      });
      await advance(0);
      expect(result.current?.status).toBe("offline");

      // Next probe (after 1s) finds both healthy again.
      horizonUp = true;
      rpcUp = true;
      await advance(BASE_MS);
      expect(result.current).toMatchObject({
        status: "online",
        horizon: "up",
        rpc: "up",
      });

      // Back to the 30s cadence rather than a backoff delay.
      const callsAfterRecovery = horizonCalls();
      await advance(HEALTHY_MS - 1);
      expect(horizonCalls()).toBe(callsAfterRecovery);
      await advance(1);
      expect(horizonCalls()).toBe(callsAfterRecovery + 1);
    });

    it("restarts the backoff from the base delay after a recovery", async () => {
      horizonUp = false;
      const { result } = renderHook(() => useNetworkStatus(), {
        wrapper: wrapper(),
      });
      await advance(0); // fail #1
      await advance(1_000); // fail #2 (next gap would be 2s)
      horizonUp = true;
      await advance(2_000); // recovers
      expect(result.current?.status).toBe("online");

      horizonUp = false;
      await advance(HEALTHY_MS); // fail again -> failure count back to 1
      const calls = horizonCalls();
      await advance(BASE_MS - 1);
      expect(horizonCalls()).toBe(calls);
      await advance(1);
      expect(horizonCalls()).toBe(calls + 1);
    });
  });

  describe("cleanup", () => {
    it("stops polling on unmount", async () => {
      horizonUp = false;
      const { unmount } = renderHook(() => useNetworkStatus(), {
        wrapper: wrapper(),
      });
      await advance(0);
      const calls = fetchMock.mock.calls.length;

      unmount();
      await advance(10 * MAX_MS);
      expect(fetchMock.mock.calls.length).toBe(calls);
    });

    it("aborts an in-flight probe on unmount and ignores its result", async () => {
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            signal = init?.signal as AbortSignal;
            signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const { result, unmount } = renderHook(() => useNetworkStatus(), {
        wrapper: wrapper(),
      });
      await advance(0);
      expect(result.current?.status).toBe("checking");

      unmount();
      expect(signal?.aborted).toBe(true);
      await advance(10 * MAX_MS);
      expect(fetchMock.mock.calls.length).toBe(2); // one Horizon + one RPC probe, no retries
    });
  });

  describe("endpoints", () => {
    it("falls back to the wallet config's URLs when no props are given", async () => {
      walletConfig = { horizonUrl: HORIZON, sorobanUrl: RPC };
      const { result } = renderHook(() => useNetworkStatus(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <NetworkStatusProvider healthyIntervalMs={HEALTHY_MS}>
            {children}
          </NetworkStatusProvider>
        ),
      });
      await advance(0);
      expect(horizonCalls()).toBe(1);
      expect(rpcCalls()).toBe(1);
      expect(result.current?.status).toBe("online");
    });

    it("resets to checking and probes the new endpoints when they change", async () => {
      const OTHER_HORIZON = "https://other-horizon.test";
      const OTHER_RPC = "https://other-rpc.test";
      const { result, rerender } = renderHook(() => useNetworkStatus(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <NetworkStatusProvider
            horizonUrl={walletConfig?.horizonUrl ?? HORIZON}
            sorobanUrl={walletConfig?.sorobanUrl ?? RPC}
            healthyIntervalMs={HEALTHY_MS}
          >
            {children}
          </NetworkStatusProvider>
        ),
      });
      await advance(0);
      expect(result.current?.status).toBe("online");

      fetchMock.mockImplementation(() => new Promise(() => {})); // new probe never answers
      walletConfig = { horizonUrl: OTHER_HORIZON, sorobanUrl: OTHER_RPC };
      rerender();
      await advance(0);

      expect(result.current?.status).toBe("checking");
      expect(
        fetchMock.mock.calls.some(([url]) => url === `${OTHER_HORIZON}/`),
      ).toBe(true);
    });
  });

  describe("useNetworkPaused", () => {
    it("is false outside a provider", () => {
      const { result } = renderHook(() => useNetworkPaused("horizon"));
      expect(result.current).toBe(false);
    });

    it("is false while the first probe is still running", async () => {
      const { result } = renderHook(() => useNetworkPaused("horizon"), {
        wrapper: wrapper(),
      });
      expect(result.current).toBe(false);
      await advance(0); // let the probe settle inside act()
    });

    it("pauses only the service that is down, and resumes on recovery", async () => {
      rpcUp = false;
      const { result } = renderHook(
        () => ({
          horizon: useNetworkPaused("horizon"),
          rpc: useNetworkPaused("rpc"),
        }),
        { wrapper: wrapper() },
      );
      await advance(0);
      expect(result.current).toEqual({ horizon: false, rpc: true });

      rpcUp = true;
      await advance(BASE_MS);
      expect(result.current).toEqual({ horizon: false, rpc: false });
    });
  });
});
