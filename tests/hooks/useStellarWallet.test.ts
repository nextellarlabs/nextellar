/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { jest } from "@jest/globals";
import * as StellarSDK from "@stellar/stellar-sdk";

const SDK = ((StellarSDK as unknown as { default?: unknown }).default ||
  StellarSDK) as typeof StellarSDK;

const mockGetAddress = jest.fn<() => Promise<{ address: string }>>();
const mockSetWallet = jest.fn();
const mockOpenModal = jest.fn();
const mockDisconnect = jest.fn<() => Promise<void>>();

await jest.unstable_mockModule(
  "../../src/templates/default/src/lib/stellar-wallet-kit.ts",
  async () => ({
    kit: () => ({
      setWallet: mockSetWallet,
      getAddress: mockGetAddress,
      openModal: mockOpenModal,
      disconnect: mockDisconnect,
    }),
  })
);

await jest.unstable_mockModule(
  "../../src/templates/default/src/lib/storage.ts",
  async () => {
    const store = new Map<string, string>();
    return {
      storage: {
        get: (key: string) => store.get(key) ?? null,
        set: (key: string, val: string) => store.set(key, val),
        remove: (key: string) => store.delete(key),
        clear: () => store.clear(),
      },
    };
  }
);

const { useStellarWallet } = await import(
  "../../src/templates/default/src/hooks/useStellarWallet.ts"
);

describe("useStellarWallet Hook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAddress.mockResolvedValue({
      address: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    });
    mockDisconnect.mockResolvedValue(undefined);

    jest
      .spyOn(SDK.Horizon.Server.prototype, "accounts")
      .mockImplementation(() => ({
        accountId: () => ({
          call: jest.fn().mockResolvedValue({ balances: [] }),
        }),
      }) as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rapid disconnect cancels in-flight connect and prevents stale state", async () => {
    let resolveAddress!: (val: { address: string }) => void;
    mockGetAddress.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAddress = resolve;
        })
    );

    const { result } = renderHook(() => useStellarWallet());

    let connectPromise: Promise<void> | undefined;
    act(() => {
      connectPromise = result.current.connect("albedo");
    });

    await act(async () => {
      result.current.disconnect();
    });

    await act(async () => {
      resolveAddress({
        address: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      });
      await connectPromise;
    });

    expect(result.current.connected).toBe(false);
    expect(result.current.publicKey).toBeUndefined();
  });

  it("connects directly when target walletId is supplied", async () => {
    const { result } = renderHook(() => useStellarWallet());

    await act(async () => {
      await result.current.connect("freighter");
    });

    expect(mockSetWallet).toHaveBeenCalledWith("freighter");
    expect(result.current.connected).toBe(true);
    expect(result.current.walletName).toBe("freighter");
    expect(result.current.publicKey).toBe(
      "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    );
  });
});
