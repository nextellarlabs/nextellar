/**
 * @jest-environment jsdom
 *
 * WalletProvider inactivity auto-lock tests (#1068)
 *
 * Covers the opt-in `inactivityTimeoutMs` prop: the wallet should
 * disconnect after the configured period with no tracked user activity,
 * the timer should reset on activity, it should be inert unless a wallet
 * is connected, and it should be fully opt-in (no prop = no auto-lock).
 *
 * This intentionally imports WalletProvider via a `../../` relative path
 * (from `tests/hooks/`) rather than from a file directly under
 * `src/templates/default/src/__tests__/`, because jest.config.mjs's
 * moduleNameMapper rewrites any `../contexts` / `../contexts/WalletProvider`
 * relative import to `src/mocks/wallet-contexts-mock.ts` (intended for
 * *consumers* of the wallet context, e.g. component tests that want to
 * inject fake wallet state). That mapping is regex-based on the import
 * specifier, so it would just as happily hijack WalletProvider's own
 * self-import if this test lived one directory above `contexts/` and
 * re-exported it the same way the module itself does — importing from two
 * directories up here sidesteps that collision entirely and exercises the
 * real WalletProvider implementation.
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

// ── Mocks (registered before the real module imports them) ────────────────────

const TEST_ADDRESS = "GTEST1234567890";

await jest.unstable_mockModule(
  "../../src/templates/default/src/lib/stellar-wallet-kit",
  () => ({
    kit: jest.fn(() => ({
      // Immediately "selects" a wallet so `connect()` resolves synchronously
      // through the same onWalletSelected path the real UI uses, without a
      // human clicking through the modal.
      openModal: jest.fn(
        async ({
          onWalletSelected,
        }: {
          onWalletSelected: (option: {
            id: string;
            name: string;
          }) => Promise<void>;
        }) => {
          await onWalletSelected({ id: "freighter", name: "Freighter" });
        },
      ),
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

const mockAccountsCall = jest.fn<() => Promise<{ balances: unknown[] }>>(() =>
  Promise.resolve({ balances: [{ balance: "100", asset_type: "native" }] }),
);

await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(() => ({
      accounts: () => ({
        accountId: () => ({
          call: mockAccountsCall,
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

function wrapperWithTimeout(inactivityTimeoutMs?: number) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <WalletProvider inactivityTimeoutMs={inactivityTimeoutMs}>
        {children}
      </WalletProvider>
    );
  };
}

/** Connects the mocked wallet and waits for state to settle. */
async function connectWallet(
  result: ReturnType<
    typeof renderHook<ReturnType<typeof useWallet>, unknown>
  >["result"],
) {
  await act(async () => {
    await result.current.connect();
  });
}

describe("WalletProvider - inactivity auto-lock (#1068)", () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
    useFakeHookTimers();
  });

  afterEach(() => {
    useRealHookTimers();
  });

  it("does not disconnect when inactivityTimeoutMs is not set", async () => {
    const { result } = renderHook(() => useWallet(), {
      wrapper: wrapperWithTimeout(undefined),
    });
    await connectWallet(result);
    expect(result.current.connected).toBe(true);

    await advanceAndFlush(60 * 60 * 1000); // 1 hour, far past any sane default

    expect(result.current.connected).toBe(true);
  });

  it("does not start a timer while disconnected", async () => {
    const { result } = renderHook(() => useWallet(), {
      wrapper: wrapperWithTimeout(5_000),
    });

    expect(result.current.connected).toBe(false);
    await advanceAndFlush(60_000);
    expect(result.current.connected).toBe(false);
  });

  it("disconnects after the configured timeout with no activity", async () => {
    const { result } = renderHook(() => useWallet(), {
      wrapper: wrapperWithTimeout(5_000),
    });
    await connectWallet(result);
    expect(result.current.connected).toBe(true);

    await advanceAndFlush(5_000);

    expect(result.current.connected).toBe(false);
    expect(result.current.publicKey).toBeUndefined();
  });

  it("does not disconnect before the timeout elapses", async () => {
    const { result } = renderHook(() => useWallet(), {
      wrapper: wrapperWithTimeout(5_000),
    });
    await connectWallet(result);

    await advanceAndFlush(4_000);

    expect(result.current.connected).toBe(true);
  });

  it("resets the timer on activity, delaying disconnect", async () => {
    const { result } = renderHook(() => useWallet(), {
      wrapper: wrapperWithTimeout(5_000),
    });
    await connectWallet(result);

    // Most of the way to the timeout...
    await advanceAndFlush(4_000);
    expect(result.current.connected).toBe(true);

    // ...then activity resets the clock.
    await act(async () => {
      window.dispatchEvent(new Event("keydown"));
    });
    await flush();

    // Advancing by the remaining 1s of the *original* window should no
    // longer disconnect, since the timer restarted.
    await advanceAndFlush(1_000);
    expect(result.current.connected).toBe(true);

    // But the full timeout from the reset point still fires.
    await advanceAndFlush(4_000);
    expect(result.current.connected).toBe(false);
  });

  it("stops the auto-lock timer once disconnected (no repeated disconnect side effects)", async () => {
    const { result } = renderHook(() => useWallet(), {
      wrapper: wrapperWithTimeout(5_000),
    });
    await connectWallet(result);
    await advanceAndFlush(5_000);
    expect(result.current.connected).toBe(false);

    const disconnectCallsSoFar = mockAccountsCall.mock.calls.length;

    // The timer that fired must have been cleared, not left running/
    // repeating — advancing well past the original timeout again should
    // produce no further activity (no new balance refetch from a stray
    // reconnect/disconnect cycle, state remains disconnected).
    await advanceAndFlush(60_000);

    expect(result.current.connected).toBe(false);
    expect(result.current.publicKey).toBeUndefined();
    expect(mockAccountsCall.mock.calls.length).toBe(disconnectCallsSoFar);
  });

  it("ignores a non-positive inactivityTimeoutMs (treated as disabled)", async () => {
    const { result } = renderHook(() => useWallet(), {
      wrapper: wrapperWithTimeout(0),
    });
    await connectWallet(result);

    await advanceAndFlush(60_000);

    expect(result.current.connected).toBe(true);
  });
});
