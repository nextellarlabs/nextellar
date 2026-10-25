/**
 * @jest-environment jsdom
 *
 * js-template WalletProvider signs on the active network (#797).
 *
 * After switchNetwork('mainnet') the provider must (a) build transactions
 * with the mainnet passphrase instead of a hardcoded testnet default, and
 * (b) hand the wallet kit the mainnet network so it re-points before signing.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { renderHook, act, waitFor } from "@testing-library/react";
import React, { ReactNode } from "react";

const PUBLIC = "Public Global Stellar Network ; September 2015";
const TESTNET = "Test SDF Network ; September 2015";

const kitNetworks: Array<string | undefined> = [];
const mockSignTransaction = jest.fn(async () => "SIGNED_XDR");
const mockKit = jest.fn((network?: string) => {
  kitNetworks.push(network);
  return {
    openModal: async ({
      onWalletSelected,
    }: {
      onWalletSelected: (o: { id: string; name: string }) => Promise<void>;
    }) => onWalletSelected({ id: "freighter", name: "Freighter" }),
    setWallet: jest.fn(),
    getAddress: jest.fn(async () => ({ address: "GTESTADDRESS" })),
    disconnect: jest.fn(async () => {}),
  };
});

await jest.unstable_mockModule(
  "../src/templates/js-template/src/lib/stellar-wallet-kit",
  () => ({
    kit: mockKit,
    getKit: mockKit,
    signTransaction: mockSignTransaction,
    WalletNetwork: { PUBLIC, TESTNET },
  }),
);

await jest.unstable_mockModule("@creit.tech/stellar-wallets-kit", () => ({
  WalletNetwork: { PUBLIC, TESTNET },
}));

const mockStorage = new Map<string, string>();
await jest.unstable_mockModule(
  "../src/templates/js-template/src/lib/storage.js",
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

const builtWith: string[] = [];
const fromXdrWith: string[] = [];
await jest.unstable_mockModule("@stellar/stellar-sdk", () => {
  const TransactionBuilder = jest.fn(
    (_account: unknown, opts: { networkPassphrase: string }) => {
      builtWith.push(opts.networkPassphrase);
      const builder = {
        addOperation: () => builder,
        addMemo: () => builder,
        setTimeout: () => builder,
        build: () => ({ toXDR: () => "UNSIGNED_XDR" }),
      };
      return builder;
    },
  ) as unknown as jest.Mock & { fromXDR: jest.Mock };
  TransactionBuilder.fromXDR = jest.fn((_xdr: string, passphrase: string) => {
    fromXdrWith.push(passphrase);
    return {};
  });
  return {
    Horizon: {
      Server: jest.fn(() => ({
        accounts: () => ({
          accountId: () => ({
            call: jest.fn(async () => ({ balances: [] })),
          }),
        }),
        loadAccount: jest.fn(async () => ({})),
        submitTransaction: jest.fn(async () => ({ hash: "abc" })),
      })),
    },
    TransactionBuilder,
    Operation: { payment: jest.fn(() => ({})) },
    Networks: { PUBLIC, TESTNET },
    Asset: Object.assign(jest.fn(), { native: jest.fn(() => ({})) }),
    Memo: { text: jest.fn() },
    BASE_FEE: "100",
  };
});

delete process.env.NEXT_PUBLIC_HORIZON_URL;
delete process.env.NEXT_PUBLIC_SOROBAN_URL;
delete process.env.NEXT_PUBLIC_NETWORK;

const { WalletProvider, useWallet, useWalletConfig } = await import(
  "../src/templates/js-template/src/contexts/WalletProvider"
);

const wrapper = ({ children }: { children: ReactNode }) => (
  <WalletProvider>{children}</WalletProvider>
);

const useBoth = () => ({ wallet: useWallet(), config: useWalletConfig() });

describe("js-template WalletProvider network-aware signing (#797)", () => {
  beforeEach(() => {
    mockStorage.clear();
    kitNetworks.length = 0;
    builtWith.length = 0;
    fromXdrWith.length = 0;
    jest.clearAllMocks();
  });

  it("re-points the passphrase when switching to mainnet", () => {
    const { result } = renderHook(useBoth, { wrapper });
    expect(result.current.config.network).toBe(TESTNET);

    act(() => {
      result.current.config.switchNetwork("mainnet");
    });

    expect(result.current.config.network).toBe(PUBLIC);
    expect(result.current.config.horizonUrl).toBe("https://horizon.stellar.org");
  });

  it("signs a payment on mainnet with the mainnet kit after a switch", async () => {
    const { result } = renderHook(useBoth, { wrapper });

    act(() => {
      result.current.config.switchNetwork("mainnet");
    });
    await act(async () => {
      await result.current.wallet.connect();
    });
    await waitFor(() => expect(result.current.wallet.connected).toBe(true));
    expect(kitNetworks).toContain(PUBLIC);

    await act(async () => {
      await result.current.wallet.sendPayment({ to: "GDEST", amount: "1" });
    });

    expect(builtWith).toEqual([PUBLIC]);
    expect(fromXdrWith).toEqual([PUBLIC]);
    expect(mockSignTransaction).toHaveBeenCalledWith({
      unsignedTransaction: "UNSIGNED_XDR",
      address: "GTESTADDRESS",
      network: PUBLIC,
      networkPassphrase: PUBLIC,
    });
  });

  it("signs on testnet by default", async () => {
    const { result } = renderHook(useBoth, { wrapper });
    await act(async () => {
      await result.current.wallet.connect();
    });
    await waitFor(() => expect(result.current.wallet.connected).toBe(true));

    await act(async () => {
      await result.current.wallet.sendPayment({ to: "GDEST", amount: "1" });
    });

    expect(mockSignTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ network: TESTNET, networkPassphrase: TESTNET }),
    );
  });

  it("surfaces a wallet signing rejection", async () => {
    mockSignTransaction.mockRejectedValueOnce(new Error("User declined"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(useBoth, { wrapper });
    await act(async () => {
      await result.current.wallet.connect();
    });
    await waitFor(() => expect(result.current.wallet.connected).toBe(true));

    await expect(
      result.current.wallet.sendPayment({ to: "GDEST", amount: "1" }),
    ).rejects.toThrow("User declined");
    errorSpy.mockRestore();
  });
});
