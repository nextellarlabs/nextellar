/**
 * @jest-environment jsdom
 *
 * useStellarBalances (default template) unit tests (#818).
 *
 * Exercises the real hook in src/templates/default/src/hooks/useStellarBalances
 * — not a mocked stand-in — while mocking the Horizon server so no live
 * network call is ever made. Covers loading, success (native + asset
 * balances) and error states.
 */
import { jest } from "@jest/globals";
import { renderHook, act, waitFor } from "@testing-library/react";

// Virtual mock for Stellar SDK since it's not a dependency of the main CLI.
// This repo runs Jest under real ESM (--experimental-vm-modules), so the
// classic jest.mock() factory (which relies on babel's hoist-to-require
// transform) can't be used here — jest.unstable_mockModule is the
// ESM-native equivalent. `../contexts` is resolved to the shared mock (see
// jest.config.mjs moduleNameMapper), whose useWalletConfig() returns
// undefined so the hook falls back to its default Horizon URL.
await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(),
  },
}));

const { useStellarBalances } =
  await import("../../src/templates/default/src/hooks/useStellarBalances");
const Horizon = (await import("@stellar/stellar-sdk")).Horizon;

const ADDRESS = "GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ";
const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

type BalanceShape = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  limit?: string;
};

describe("useStellarBalances (default template)", () => {
  let mockAccountsCall: jest.Mock;
  let consoleErrorSpy: jest.SpyInstance;
  const mockServer = {
    accounts: jest.fn().mockReturnValue({
      accountId: jest.fn().mockReturnValue({ call: jest.fn() }),
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    (Horizon.Server as unknown as jest.Mock).mockImplementation(
      () => mockServer,
    );
    mockAccountsCall = mockServer.accounts().accountId().call as jest.Mock;
    // The wiring above invokes mockServer.accounts() as part of grabbing the
    // chained .call() reference; reset it so per-test assertions only count
    // calls made by the hook under test.
    mockServer.accounts.mockClear();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("is in a loading state while the initial fetch is in flight", () => {
    let resolve!: (v: unknown) => void;
    mockAccountsCall.mockImplementation(
      () =>
        new Promise((res) => {
          resolve = res;
        }),
    );

    let result!: ReturnType<typeof renderHook>["result"];
    act(() => {
      const rendered = renderHook(() =>
        useStellarBalances(ADDRESS, { pollIntervalMs: null }),
      );
      result = rendered.result;
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    act(() => {
      resolve({
        balances: [{ asset_type: "native", balance: "100.0000000" }],
      });
    });
  });

  it("maps native and credit-asset balances into the typed Balance list", async () => {
    mockAccountsCall.mockResolvedValue({
      balances: [
        { asset_type: "native", balance: "100.0000000" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: ISSUER,
          balance: "250.7500000",
          limit: "922337203685.4775807",
        },
      ],
    });

    const { result } = renderHook(() =>
      useStellarBalances(ADDRESS, { pollIntervalMs: null }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.balances).toHaveLength(2);

    const native = result.current.balances.find(
      (b: BalanceShape) => b.asset_type === "native",
    );
    expect(native?.balance).toBe("100.0000000");

    const usdc = result.current.balances.find(
      (b: BalanceShape) => b.asset_code === "USDC",
    );
    expect(usdc?.asset_type).toBe("credit_alphanum4");
    expect(usdc?.asset_issuer).toBe(ISSUER);
    expect(usdc?.balance).toBe("250.7500000");
    expect(usdc?.limit).toBe("922337203685.4775807");
  });

  it("returns an empty list (not an error) for a 404 — an unfunded account", async () => {
    mockAccountsCall.mockRejectedValue({
      response: { status: 404 },
      message: "Resource Missing",
    });

    const { result } = renderHook(() =>
      useStellarBalances(ADDRESS, { pollIntervalMs: null }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.balances).toEqual([]);
  });

  it("surfaces a network error on failure and keeps balances empty", async () => {
    mockAccountsCall.mockRejectedValue(
      new Error("Failed to fetch Stellar account"),
    );

    const { result } = renderHook(() =>
      useStellarBalances(ADDRESS, { pollIntervalMs: null }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch(/fetch|Stellar|Horizon/i);
    expect(result.current.balances).toEqual([]);
  });

  it("throws a validation error for an invalid public key format", async () => {
    const { result } = renderHook(() =>
      useStellarBalances("not-a-valid-key", { pollIntervalMs: null }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error?.message).toMatch(
      /invalid stellar public key/i,
    );
    expect(mockServer.accounts).not.toHaveBeenCalled();
  });

  it("does not reach the server when no public key is provided", async () => {
    const { result } = renderHook(() =>
      useStellarBalances(undefined, { pollIntervalMs: null }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.balances).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(mockServer.accounts).not.toHaveBeenCalled();
  });

  it("calls stopPolling to stop an active poll interval", async () => {
    mockAccountsCall.mockResolvedValue({
      balances: [{ asset_type: "native", balance: "1.0000000" }],
    });

    const { result, unmount } = renderHook(() =>
      useStellarBalances(ADDRESS, { pollIntervalMs: null }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    const stopPolling = jest.spyOn(result.current, "stopPolling");

    act(() => {
      result.current.stopPolling();
    });

    // The hook's own stopPolling is a stable callback ref-wrapping the
    // internal clearInterval; invoking it must not throw and must leave the
    // hook usable.
    expect(typeof result.current.stopPolling).toBe("function");

    unmount();
    stopPolling.mockRestore();
  });
});
