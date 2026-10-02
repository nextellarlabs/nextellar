/**
 * @jest-environment jsdom
 *
 * WalletProvider connect() exponential backoff tests (#1070)
 *
 * Verifies that repeated connect() failures back off exponentially instead
 * of retrying eagerly: each subsequent attempt after a failure waits
 * `1s → 3s → 9s → ...`, capped at 30s, and a successful connection resets
 * the counter so a later session is eager again.
 *
 * See the sibling WalletProvider.inactivityTimeout.test.tsx for why this
 * lives under tests/hooks/ (two `../` segments) rather than directly beside
 * WalletProvider's own __tests__ directory: jest.config.mjs's
 * moduleNameMapper rewrites any *single*-`../`-relative import of
 * `../contexts` / `../contexts/WalletProvider` to the component-test mock
 * in src/mocks/wallet-contexts-mock.ts, which would hijack WalletProvider's
 * own self-reference. Importing from two directories up resolves to the
 * real module instead.
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

// ── Mocks ───────────────────────────────────────────────────────────────────

const TEST_ADDRESS = "GTEST1234567890";

// `openModal` is driven per-test via `openModalImpl` so each test can choose
// whether this attempt succeeds (invokes onWalletSelected) or fails (rejects).
let openModalImpl: (opts: {
  onWalletSelected: (option: { id: string; name: string }) => Promise<void>;
}) => Promise<void>;

const openModalMock = jest.fn(
  (opts: {
    onWalletSelected: (option: { id: string; name: string }) => Promise<void>;
  }) => openModalImpl(opts),
);

await jest.unstable_mockModule(
  "../../src/templates/default/src/lib/stellar-wallet-kit",
  () => ({
    kit: jest.fn(() => ({
      openModal: openModalMock,
      setWallet: jest.fn(),
      getAddress: jest.fn(() => Promise.resolve({ address: TEST_ADDRESS })),
      disconnect: jest.fn(() => Promise.resolve()),
      signTransaction: jest.fn(),
    })),
    WalletNetwork: { PUBLIC: "PUBLIC", TESTNET: "TESTNET" },
  }),
);

const mockStorage = new Map<string, string>();
await jest.unstable_mockModule(
  "../../src/templates/default/src/lib/storage",
  () => ({
    storage: {
      get: (key: string) => mockStorage.get(key) ?? null,
      set: (key: string, value: string) => {
        mockStorage.set(key, value);
      },
      remove: (key: string) => {
        mockStorage.delete(key);
      },
    },
  }),
);

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => ({
      accounts: () => ({
        accountId: () => ({
          call: jest.fn(() =>
            Promise.resolve({
              balances: [{ balance: "100", asset_type: "native" }],
            }),
          ),
        }),
      }),
      loadAccount: jest.fn(() => Promise.resolve({})),
      submitTransaction: jest.fn(() => Promise.resolve({})),
    })),
  },
  TransactionBuilder: jest.fn(),
  Operation: { payment: jest.fn() },
  Networks: { PUBLIC: "PUBLIC", TESTNET: "TESTNET" },
  Asset: jest.fn(),
  Memo: { text: jest.fn() },
  BASE_FEE: "100",
}));

const { WalletProvider, useWallet } =
  await import("../../src/templates/default/src/contexts/WalletProvider");

// ── Helpers ─────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}

function succeed() {
  openModalImpl = async ({ onWalletSelected }) => {
    await onWalletSelected({ id: "freighter", name: "Freighter" });
  };
}

function fail(message = "User rejected") {
  openModalImpl = async () => {
    throw new Error(message);
  };
}

/**
 * Kicks off `connect()` without awaiting it directly (so the caller can
 * advance fake timers while the backoff delay is pending), and returns a
 * settled-state promise plus a way to inspect whether/how it resolved.
 */
function startConnect(
  result: ReturnType<
    typeof renderHook<ReturnType<typeof useWallet>, unknown>
  >["result"],
) {
  let status: "pending" | "resolved" | "rejected" = "pending";
  let rejection: unknown;
  const promise = result.current
    .connect()
    .then(() => {
      status = "resolved";
    })
    .catch((err: unknown) => {
      status = "rejected";
      rejection = err;
    });
  return {
    promise,
    getStatus: () => status,
    getRejection: () => rejection,
  };
}

describe("WalletProvider - connect() exponential backoff (#1070)", () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
    useFakeHookTimers();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    useRealHookTimers();
    consoleErrorSpy.mockRestore();
  });

  it("attempts the first connect immediately, with no backoff delay", async () => {
    succeed();
    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });

    const { promise, getStatus } = startConnect(result);
    await flush();

    expect(getStatus()).toBe("resolved");
    expect(openModalMock).toHaveBeenCalledTimes(1);
    await promise;
  });

  it("waits ~1s before the attempt right after a single failure", async () => {
    fail();
    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });

    // First attempt fails immediately (no prior failures => no delay).
    const first = startConnect(result);
    await flush();
    expect(first.getStatus()).toBe("rejected");
    expect(openModalMock).toHaveBeenCalledTimes(1);

    // Second attempt: should NOT call openModal until ~1s has elapsed.
    succeed();
    const second = startConnect(result);
    await flush();
    expect(openModalMock).toHaveBeenCalledTimes(1); // still just the first call

    await advanceAndFlush(999);
    expect(openModalMock).toHaveBeenCalledTimes(1); // just under the 1s delay

    await advanceAndFlush(1);
    await second.promise;
    expect(openModalMock).toHaveBeenCalledTimes(2);
    expect(second.getStatus()).toBe("resolved");
  });

  it("increases the delay exponentially across consecutive failures (1s -> 3s -> 9s)", async () => {
    fail();
    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });

    // Failure #1 (eager, no delay).
    await startConnect(result).promise;
    await flush();

    // Attempt after failure #1: waits 1s, then fails again (failure #2).
    const attempt2 = startConnect(result);
    await advanceAndFlush(1_000);
    await attempt2.promise;
    expect(attempt2.getStatus()).toBe("rejected");
    expect(openModalMock).toHaveBeenCalledTimes(2);

    // Attempt after failure #2: should wait 3s, not fire early.
    const attempt3 = startConnect(result);
    await advanceAndFlush(2_999);
    expect(openModalMock).toHaveBeenCalledTimes(2);
    await advanceAndFlush(1);
    await attempt3.promise;
    expect(openModalMock).toHaveBeenCalledTimes(3);
    expect(attempt3.getStatus()).toBe("rejected");

    // Attempt after failure #3: should wait 9s.
    succeed();
    const attempt4 = startConnect(result);
    await advanceAndFlush(8_999);
    expect(openModalMock).toHaveBeenCalledTimes(3);
    await advanceAndFlush(1);
    await attempt4.promise;
    expect(openModalMock).toHaveBeenCalledTimes(4);
    expect(attempt4.getStatus()).toBe("resolved");
  });

  it("caps the backoff delay at 30s even after many failures", async () => {
    fail();
    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });

    // Drive enough consecutive failures that the formula (1s * 3^n) would
    // exceed the 30s cap (3^4 = 81s uncapped): failure #1 is eager, then
    // each subsequent attempt must wait its predecessor's full delay
    // before firing (and failing again) — 0s, 1s, 3s, 9s, 27s.
    const delaysBeforeEachFailure = [0, 1_000, 3_000, 9_000, 27_000];
    for (const delay of delaysBeforeEachFailure) {
      const attempt = startConnect(result);
      if (delay > 0) {
        await advanceAndFlush(delay);
      } else {
        await flush();
      }
      await attempt.promise;
    }
    expect(openModalMock).toHaveBeenCalledTimes(delaysBeforeEachFailure.length);

    // The 6th attempt, after 5 consecutive failures, would be 1s * 3^5 =
    // 243s uncapped — it must instead wait exactly the 30s cap.
    const callsBeforeNextAttempt = openModalMock.mock.calls.length;
    succeed();
    const nextAttempt = startConnect(result);

    // Just under the 30s cap: must not have attempted yet.
    await advanceAndFlush(29_999);
    expect(openModalMock).toHaveBeenCalledTimes(callsBeforeNextAttempt);

    // At the 30s cap: the attempt fires (not later — the cap, not a
    // continued exponential climb toward 243s).
    await advanceAndFlush(1);
    await nextAttempt.promise;
    expect(openModalMock).toHaveBeenCalledTimes(callsBeforeNextAttempt + 1);
    expect(nextAttempt.getStatus()).toBe("resolved");
  });

  it("resets the backoff counter after a successful connection", async () => {
    fail();
    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });

    await startConnect(result).promise; // failure #1, eager, no delay
    succeed();
    const secondAttempt = startConnect(result);
    await advanceAndFlush(1_000); // failure #1's 1s backoff
    await secondAttempt.promise;
    expect(secondAttempt.getStatus()).toBe("resolved");

    // Now disconnect and reconnect — should be eager again (no leftover
    // backoff from the earlier failure).
    await act(async () => {
      await result.current.disconnect();
    });

    fail();
    const thirdAttempt = startConnect(result);
    await flush();
    expect(thirdAttempt.getStatus()).toBe("rejected");
    // openModal was called immediately (no delay), proving the counter reset.
  });
});
