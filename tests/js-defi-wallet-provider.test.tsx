/**
 * @jest-environment jsdom
 *
 * Network-switch machinery for the js-defi template WalletProvider (#811).
 *
 * Asserts the contract the NetworkSwitcher depends on: the provider exposes
 * switchNetwork/activeNetworkKey, persists the choice, and re-points the
 * Horizon/Soroban endpoints (and the network passphrase) at the newly
 * selected network rather than staying pinned to the one it booted with.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";
import React, { ReactNode } from "react";

// Jest runs under real ESM here, so mocks must be registered with
// unstable_mockModule and awaited before the module under test is imported.
const mockKit = jest.fn(() => ({
  openModal: jest.fn(),
  setWallet: jest.fn(),
  getAddress: jest.fn(() => Promise.resolve({ address: "GTEST1234567890" })),
  disconnect: jest.fn(() => Promise.resolve()),
  signTransaction: jest.fn(),
}));

await jest.unstable_mockModule(
  "../src/templates/js-defi/src/lib/stellar-wallet-kit",
  () => ({
    kit: mockKit,
    getKit: mockKit,
    signTransaction: jest.fn(),
    WalletNetwork: { PUBLIC: "PUBLIC", TESTNET: "TESTNET" },
  }),
);

// The provider imports WalletNetwork from the kit package at module scope,
// which otherwise pulls in @albedo-link/intent and fails under jsdom with
// "Browser FetchAPI is not available".
await jest.unstable_mockModule("@creit.tech/stellar-wallets-kit", () => ({
  WalletNetwork: { PUBLIC: "PUBLIC", TESTNET: "TESTNET" },
}));

const mockStorage = new Map<string, string>();
await jest.unstable_mockModule(
  "../src/templates/js-defi/src/lib/storage.js",
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

// Records every Horizon URL the provider constructs a Server for, so the test
// can prove a switch re-points the client instead of reusing the first one.
const serverUrls: string[] = [];
await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  Horizon: {
    Server: jest.fn((url: string) => {
      serverUrls.push(url);
      return {
        accounts: () => ({
          accountId: () => ({
            call: jest.fn(() => Promise.resolve({ balances: [] })),
          }),
        }),
        loadAccount: jest.fn(() => Promise.resolve({})),
        submitTransaction: jest.fn(() => Promise.resolve({})),
      };
    }),
  },
  TransactionBuilder: jest.fn(),
  Operation: { payment: jest.fn() },
  Networks: { PUBLIC: "PUBLIC", TESTNET: "TESTNET" },
  Asset: jest.fn(),
  Memo: { text: jest.fn() },
  BASE_FEE: "100",
}));

const [{ WalletProvider, useWallet, useWalletConfig }, { NETWORKS }] =
  await Promise.all([
    import("../src/templates/js-defi/src/contexts/WalletProvider"),
    import("../src/templates/js-defi/src/config/networks"),
  ]);

// An explicit endpoint pins the provider to that URL by design, so clear the
// env vars to exercise the per-network defaults the switcher relies on.
delete process.env.NEXT_PUBLIC_HORIZON_URL;
delete process.env.NEXT_PUBLIC_SOROBAN_URL;

const wrapper = ({ children }: { children: ReactNode }) => (
  <WalletProvider>{children}</WalletProvider>
);

describe("js-defi WalletProvider network switching (#811)", () => {
  beforeEach(() => {
    mockStorage.clear();
    serverUrls.length = 0;
    jest.clearAllMocks();
  });

  it("exposes switchNetwork and activeNetworkKey from useWallet", () => {
    const { result } = renderHook(() => useWallet(), { wrapper });

    expect(typeof result.current.switchNetwork).toBe("function");
    expect(result.current.activeNetworkKey).toBe("testnet");
  });

  it("exposes switchNetwork and activeNetworkKey from useWalletConfig", () => {
    const { result } = renderHook(() => useWalletConfig(), { wrapper });

    expect(typeof result.current.switchNetwork).toBe("function");
    expect(result.current.activeNetworkKey).toBe("testnet");
    expect(result.current.horizonUrl).toBe(NETWORKS.testnet.horizonUrl);
  });

  it("re-points horizon, soroban and passphrase when switching to mainnet", () => {
    const { result } = renderHook(() => useWalletConfig(), { wrapper });

    act(() => {
      result.current.switchNetwork("mainnet");
    });

    expect(result.current.activeNetworkKey).toBe("mainnet");
    expect(result.current.horizonUrl).toBe(NETWORKS.mainnet.horizonUrl);
    expect(result.current.sorobanUrl).toBe(NETWORKS.mainnet.sorobanUrl);
    expect(result.current.network).toBe(NETWORKS.mainnet.passphrase);
  });

  it("constructs a new Horizon server for the newly selected network", () => {
    const { result } = renderHook(() => useWalletConfig(), { wrapper });

    act(() => {
      result.current.switchNetwork("mainnet");
    });

    expect(serverUrls).toContain(NETWORKS.mainnet.horizonUrl);
  });

  it("persists the selected network so it survives a remount", () => {
    const first = renderHook(() => useWalletConfig(), { wrapper });

    act(() => {
      first.result.current.switchNetwork("mainnet");
    });
    expect(mockStorage.get("stellar_network")).toBe("mainnet");

    first.unmount();

    const second = renderHook(() => useWalletConfig(), { wrapper });
    expect(second.result.current.activeNetworkKey).toBe("mainnet");
  });

  it("ignores an unknown network key", () => {
    const { result } = renderHook(() => useWalletConfig(), { wrapper });

    act(() => {
      result.current.switchNetwork("not-a-network");
    });

    expect(result.current.activeNetworkKey).toBe("testnet");
    expect(mockStorage.has("stellar_network")).toBe(false);
  });
});
