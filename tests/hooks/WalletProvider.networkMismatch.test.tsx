/**
 * @jest-environment jsdom
 *
 * WalletProvider network-mismatch detection (#1072).
 *
 * See WalletProvider.connectBackoff.test.tsx's header comment for why this
 * lives under tests/hooks/ (two `../` segments resolve to the real
 * WalletProvider module rather than the component-test mock).
 */
import { jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";

const TEST_ADDRESS = "GTEST1234567890";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

// `getNetworkImpl` is driven per-test so each one can choose what the wallet
// itself reports (or have it fail, simulating a wallet that doesn't
// implement getNetwork()).
let getNetworkImpl: () => Promise<{
  network: string;
  networkPassphrase: string;
}>;

const getNetworkMock = jest.fn(() => getNetworkImpl());

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
      getNetwork: getNetworkMock,
      disconnect: jest.fn(() => Promise.resolve()),
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

function Wrapper({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}

async function connectWith(networkPassphrase: string | Error) {
  getNetworkImpl =
    networkPassphrase instanceof Error
      ? () => Promise.reject(networkPassphrase)
      : () => Promise.resolve({ network: "unused", networkPassphrase });
  openModalImpl = async ({ onWalletSelected }) => {
    await onWalletSelected({ id: "freighter", name: "Freighter" });
  };

  const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });
  await act(async () => {
    await result.current.connect();
  });
  return result;
}

describe("WalletProvider - network mismatch detection (#1072)", () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("reports no mismatch when the wallet's network matches the app's default (testnet)", async () => {
    const result = await connectWith(TESTNET_PASSPHRASE);

    expect(result.current.walletNetworkPassphrase).toBe(TESTNET_PASSPHRASE);
    expect(result.current.networkMismatch).toBe(false);
  });

  it("reports a mismatch when the wallet is on mainnet but the app is configured for testnet", async () => {
    const result = await connectWith(MAINNET_PASSPHRASE);

    expect(result.current.walletNetworkPassphrase).toBe(MAINNET_PASSPHRASE);
    expect(result.current.networkMismatch).toBe(true);
  });

  it("does not report a mismatch when the wallet can't answer getNetwork() (unknown is not a mismatch)", async () => {
    const result = await connectWith(new Error("not supported"));

    expect(result.current.walletNetworkPassphrase).toBeUndefined();
    expect(result.current.networkMismatch).toBe(false);
  });

  it("clears the mismatch state on disconnect", async () => {
    const result = await connectWith(MAINNET_PASSPHRASE);
    expect(result.current.networkMismatch).toBe(true);

    await act(async () => {
      await result.current.disconnect();
    });

    expect(result.current.networkMismatch).toBe(false);
    expect(result.current.walletNetworkPassphrase).toBeUndefined();
  });

  it("never reports a mismatch while disconnected, even if a stale wallet passphrase were somehow present", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });

    expect(result.current.connected).toBe(false);
    expect(result.current.networkMismatch).toBe(false);
  });
});
