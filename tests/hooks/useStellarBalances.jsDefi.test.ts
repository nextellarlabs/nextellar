/**
 * @jest-environment jsdom
 *
 * useStellarBalances (js-defi template) unit tests (#843).
 *
 * Exercises the real hook in src/templates/js-defi/src/hooks/useStellarBalances
 * — not a mocked stand-in — while mocking the Horizon server so no live
 * network call is ever made. Focuses on the unfunded / account-not-found
 * (404) path returning an explicit empty state rather than an error.
 */
import { jest } from "@jest/globals";
import { renderHook, waitFor } from "@testing-library/react";

// Virtual mock for Stellar SDK since it's not a dependency of the main CLI.
// This repo runs Jest under real ESM (--experimental-vm-modules), so the
// classic jest.mock() factory can't be used here — jest.unstable_mockModule is
// the ESM-native equivalent. `../contexts` is resolved to the shared mock (see
// jest.config.mjs moduleNameMapper), whose useWalletConfig() returns
// undefined so the hook falls back to its default Horizon URL.
await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn(),
  },
}));

const { useStellarBalances } =
  await import("../../src/templates/js-defi/src/hooks/useStellarBalances");
const Horizon = (await import("@stellar/stellar-sdk")).Horizon;

const ADDRESS = "GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ";

describe("useStellarBalances (js-defi template)", () => {
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

  it("maps native and credit-asset balances into the typed Balance list", async () => {
    mockAccountsCall.mockResolvedValue({
      balances: [
        { asset_type: "native", balance: "100.0000000" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: ADDRESS,
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
    expect(result.current.balances[0].asset_type).toBe("native");
    expect(result.current.balances[0].balance).toBe("100.0000000");
    expect(result.current.balances[1].asset_code).toBe("USDC");
    expect(result.current.balances[1].balance).toBe("250.7500000");
  });
});
