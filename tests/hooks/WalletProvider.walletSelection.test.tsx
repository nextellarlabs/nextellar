/**
 * @jest-environment jsdom
 *
 * WalletProvider wallet selection (#911) and persisted-session UX (#910).
 *
 * - getWallets() lists every configured wallet with icon, name and install
 *   state, for the built-in WalletSelectModal.
 * - connect(walletId) connects that wallet directly (no kit modal), and
 *   rejects unknown or not-installed wallets.
 * - The mount-time auto-reconnect exposes `reconnecting`, restores a matching
 *   session, and forgets a persisted session that no longer matches.
 *
 * Lives under tests/hooks/ for the same moduleNameMapper reason as the
 * sibling WalletProvider.*.test.tsx files.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const ADDRESS = "GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const supportedWallets = [
  {
    id: "freighter",
    name: "Freighter",
    icon: "https://example.test/freighter.png",
    isAvailable: true,
    url: "https://freighter.app",
    type: "HOT_WALLET",
  },
  {
    id: "xbull",
    name: "xBull",
    icon: "https://example.test/xbull.png",
    isAvailable: false,
    url: "https://xbull.app",
    type: "HOT_WALLET",
  },
];

const openModalMock = jest.fn(async () => {});
const setWalletMock = jest.fn();
let addressImpl: () => Promise<{ address: string }> = async () => ({
  address: ADDRESS,
});
const getSupportedWalletsMock = jest.fn(async () => supportedWallets);

await jest.unstable_mockModule(
  "../../src/templates/default/src/lib/stellar-wallet-kit",
  () => ({
    kit: jest.fn(() => ({
      openModal: openModalMock,
      setWallet: setWalletMock,
      getAddress: () => addressImpl(),
      getNetwork: jest.fn(async () => ({
        networkPassphrase: "Test SDF Network ; September 2015",
      })),
      getSupportedWallets: getSupportedWalletsMock,
      disconnect: jest.fn(async () => {}),
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
          call: jest.fn(async () => ({ balances: [] })),
        }),
      }),
      loadAccount: jest.fn(async () => ({})),
      submitTransaction: jest.fn(async () => ({})),
    })),
  },
  TransactionBuilder: jest.fn(),
  Operation: { payment: jest.fn() },
  Networks: { PUBLIC: "PUBLIC", TESTNET: "TESTNET" },
  Asset: jest.fn(),
  Memo: { text: jest.fn() },
  BASE_FEE: "100",
}));

const { WalletProvider, useWallet } = await import(
  "../../src/templates/default/src/contexts/WalletProvider"
);

function Wrapper({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}

function persistSession(address = ADDRESS) {
  mockStorage.set("stellar_wallet_connected", "true");
  mockStorage.set("stellar_wallet_id", "freighter");
  mockStorage.set("stellar_wallet_address", address);
  mockStorage.set("stellar_wallet_name", "Freighter");
}

describe("WalletProvider wallet selection (#911)", () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
    addressImpl = async () => ({ address: ADDRESS });
  });

  it("lists configured wallets with name, icon and install state", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });

    let wallets: Awaited<ReturnType<NonNullable<typeof result.current.getWallets>>> = [];
    await act(async () => {
      wallets = await result.current.getWallets!();
    });

    expect(wallets).toEqual([
      {
        id: "freighter",
        name: "Freighter",
        icon: "https://example.test/freighter.png",
        isAvailable: true,
        url: "https://freighter.app",
      },
      {
        id: "xbull",
        name: "xBull",
        icon: "https://example.test/xbull.png",
        isAvailable: false,
        url: "https://xbull.app",
      },
    ]);
  });

  it("connect(walletId) connects that wallet without the kit modal", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.connect("freighter");
    });

    expect(openModalMock).not.toHaveBeenCalled();
    expect(setWalletMock).toHaveBeenCalledWith("freighter");
    expect(result.current.connected).toBe(true);
    expect(result.current.walletName).toBe("Freighter");
    expect(mockStorage.get("stellar_wallet_id")).toBe("freighter");
  });

  it("connect() with no id still opens the kit modal", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.connect();
    });

    expect(openModalMock).toHaveBeenCalledTimes(1);
  });

  it("treats a click event passed as onClick={connect} like connect()", async () => {
    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });

    await act(async () => {
      await (result.current.connect as (arg?: unknown) => Promise<void>)({
        type: "click",
      });
    });

    expect(openModalMock).toHaveBeenCalledTimes(1);
    expect(getSupportedWalletsMock).not.toHaveBeenCalled();
  });

  it("rejects a wallet that is not installed", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.connect("xbull")).rejects.toThrow(
        "xBull is not installed.",
      );
    });

    expect(result.current.connected).toBe(false);
    expect(setWalletMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("rejects an unknown wallet id", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.connect("nope")).rejects.toThrow(
        /not configured/,
      );
    });
    errorSpy.mockRestore();
  });
});

describe("WalletProvider persisted session (#910)", () => {
  beforeEach(() => {
    mockStorage.clear();
    jest.clearAllMocks();
    addressImpl = async () => ({ address: ADDRESS });
  });

  it("is not reconnecting when nothing was persisted", () => {
    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });
    expect(result.current.reconnecting).toBe(false);
    expect(result.current.connected).toBe(false);
  });

  it("reports reconnecting while restoring, then restores the session", async () => {
    persistSession();
    let release!: () => void;
    addressImpl = () =>
      new Promise((resolve) => {
        release = () => resolve({ address: ADDRESS });
      });

    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.reconnecting).toBe(true));
    expect(result.current.connected).toBe(false);

    await act(async () => {
      release();
    });

    await waitFor(() => expect(result.current.reconnecting).toBe(false));
    expect(result.current.connected).toBe(true);
    expect(result.current.publicKey).toBe(ADDRESS);
  });

  it("forgets a persisted session whose address no longer matches", async () => {
    persistSession("GSOMEONEELSE");

    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });

    await waitFor(() =>
      expect(mockStorage.has("stellar_wallet_connected")).toBe(false),
    );
    expect(result.current.connected).toBe(false);
    expect(result.current.reconnecting).toBe(false);
    expect(mockStorage.has("stellar_wallet_address")).toBe(false);
  });

  it("forgets the session and stops reconnecting when the wallet errors", async () => {
    persistSession();
    addressImpl = async () => {
      throw new Error("locked");
    };

    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.reconnecting).toBe(false));
    await waitFor(() =>
      expect(mockStorage.has("stellar_wallet_connected")).toBe(false),
    );
    expect(result.current.connected).toBe(false);
  });

  it("does not reconnect after an explicit disconnect and reload", async () => {
    const first = renderHook(() => useWallet(), { wrapper: Wrapper });
    await act(async () => {
      await first.result.current.connect("freighter");
    });
    await act(async () => {
      await first.result.current.disconnect();
    });
    first.unmount();

    const second = renderHook(() => useWallet(), { wrapper: Wrapper });
    expect(second.result.current.reconnecting).toBe(false);
    expect(second.result.current.connected).toBe(false);
    expect(mockStorage.has("stellar_wallet_connected")).toBe(false);
  });
});
