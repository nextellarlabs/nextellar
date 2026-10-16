import { Networks } from "@stellar/stellar-sdk";
import {
  createWalletConnectModule,
  readWalletConnectConfig,
  WALLETCONNECT_WALLET_ID,
  WalletConnectConfigError,
  WalletConnectWalletModule,
  type WalletConnectConfig,
} from "../../src/templates/default/src/lib/wallets/walletconnect-module";

const PROJECT_ID = "0123456789abcdef0123456789abcdef";

const CONFIG: WalletConnectConfig = {
  projectId: PROJECT_ID,
  name: "Test dApp",
  description: "Test dApp on Stellar",
  url: "https://dapp.example",
  icons: [],
  network: Networks.TESTNET,
};

function fakeInner() {
  return {
    getAddress: jest.fn(async () => ({ address: "GWALLETCONNECT" })),
    signTransaction: jest.fn(async (xdr: string) => ({
      signedTxXdr: `${xdr}-signed`,
      signerAddress: "GWALLETCONNECT",
    })),
    signAuthEntry: jest.fn(async () => ({ signedAuthEntry: "auth" })),
    signMessage: jest.fn(async () => {
      throw {
        code: -3,
        message: 'WalletConnect does not support the "signMessage" function',
      };
    }),
    disconnect: jest.fn(async () => undefined),
  };
}

describe("readWalletConnectConfig (#1066)", () => {
  it("returns null when no project ID is set", () => {
    expect(readWalletConnectConfig({}, Networks.TESTNET)).toBeNull();
    expect(
      readWalletConnectConfig(
        { NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "  " },
        Networks.TESTNET,
      ),
    ).toBeNull();
  });

  it("builds the dApp metadata from env", () => {
    expect(
      readWalletConnectConfig(
        {
          NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: PROJECT_ID,
          NEXT_PUBLIC_WALLETCONNECT_APP_URL: "https://dapp.example",
          NEXT_PUBLIC_WALLETCONNECT_ICON: "https://dapp.example/icon.png",
          NEXT_PUBLIC_APP_NAME: "My dApp",
        },
        Networks.PUBLIC,
      ),
    ).toEqual({
      projectId: PROJECT_ID,
      name: "My dApp",
      description: "My dApp on Stellar",
      url: "https://dapp.example",
      icons: ["https://dapp.example/icon.png"],
      network: Networks.PUBLIC,
    });
  });

  it.each([
    [
      { NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "not-a-project-id" },
      /32-character/,
    ],
    [
      {
        NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: PROJECT_ID,
        NEXT_PUBLIC_WALLETCONNECT_APP_URL: "http://dapp.example",
      },
      /https/,
    ],
    [
      {
        NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: PROJECT_ID,
        NEXT_PUBLIC_WALLETCONNECT_ICON: "nope",
      },
      /valid URL/,
    ],
  ])("rejects misconfiguration %j", (env, message) => {
    expect(() => readWalletConnectConfig(env, Networks.TESTNET)).toThrow(
      message,
    );
  });
});

describe("WalletConnectWalletModule (#1066)", () => {
  it("implements the adapter metadata and is available once configured", async () => {
    const module = new WalletConnectWalletModule(CONFIG, async () =>
      fakeInner(),
    );
    expect(module.productId).toBe(WALLETCONNECT_WALLET_ID);
    expect(module.moduleType).toBe("BRIDGE_WALLET");
    expect(await module.isAvailable()).toBe(true);
    expect(await module.isPlatformWrapper()).toBe(false);
  });

  it("loads the WalletConnect SDK lazily, once", async () => {
    const inner = fakeInner();
    const loader = jest.fn(async () => inner);
    const module = new WalletConnectWalletModule(CONFIG, loader);
    expect(loader).not.toHaveBeenCalled();

    await module.getAddress();
    await module.getAddress();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith(CONFIG);
  });

  it("delegates signing with the configured network passphrase", async () => {
    const inner = fakeInner();
    const module = new WalletConnectWalletModule(CONFIG, async () => inner);
    await expect(module.signTransaction("AAA")).resolves.toEqual({
      signedTxXdr: "AAA-signed",
      signerAddress: "GWALLETCONNECT",
    });
    expect(inner.signTransaction).toHaveBeenCalledWith("AAA", {
      networkPassphrase: Networks.TESTNET,
    });
  });

  it("reports the configured network instead of calling the unsupported getNetwork", async () => {
    const module = new WalletConnectWalletModule(
      { ...CONFIG, network: Networks.PUBLIC },
      async () => fakeInner(),
    );
    await expect(module.getNetwork()).resolves.toEqual({
      network: "PUBLIC",
      networkPassphrase: Networks.PUBLIC,
    });
  });

  it("normalises rejected and expired-session errors", async () => {
    const inner = fakeInner();
    inner.signTransaction
      .mockRejectedValueOnce({ message: "User rejected the request." })
      .mockRejectedValueOnce(
        new Error("No matching key. session topic doesn't exist"),
      );
    const module = new WalletConnectWalletModule(CONFIG, async () => inner);
    await expect(module.signTransaction("A")).rejects.toThrow(
      "WalletConnect request was rejected in the wallet.",
    );
    await expect(module.signTransaction("A")).rejects.toThrow(
      "WalletConnect session expired. Reconnect your wallet.",
    );
    await expect(module.signMessage("hi")).rejects.toThrow(/does not support/);
  });

  it("retries loading after a failed load", async () => {
    const loader = jest
      .fn()
      .mockRejectedValueOnce(new Error("chunk load failed"))
      .mockResolvedValue(fakeInner());
    const module = new WalletConnectWalletModule(CONFIG, loader);
    await expect(module.getAddress()).rejects.toThrow("chunk load failed");
    await expect(module.getAddress()).resolves.toEqual({
      address: "GWALLETCONNECT",
    });
  });

  it("disconnect closes the session and forces a fresh load next time", async () => {
    const inner = fakeInner();
    const loader = jest.fn(async () => inner);
    const module = new WalletConnectWalletModule(CONFIG, loader);
    await module.disconnect(); // no-op before use
    await module.getAddress();
    await module.disconnect();
    expect(inner.disconnect).toHaveBeenCalledTimes(1);
    await module.getAddress();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid project ID at construction", () => {
    expect(
      () => new WalletConnectWalletModule({ ...CONFIG, projectId: "x" }),
    ).toThrow(WalletConnectConfigError);
  });
});

describe("createWalletConnectModule (#1066)", () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  afterAll(() => warn.mockRestore());

  it("returns a module when configured", () => {
    const module = createWalletConnectModule(
      {
        NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: PROJECT_ID,
        NEXT_PUBLIC_WALLETCONNECT_APP_URL: "https://dapp.example",
      },
      Networks.TESTNET,
      async () => fakeInner(),
    );
    expect(module).toBeInstanceOf(WalletConnectWalletModule);
  });

  it("returns null (wallet hidden) when unconfigured or misconfigured", () => {
    expect(createWalletConnectModule({}, Networks.TESTNET)).toBeNull();
    expect(
      createWalletConnectModule(
        { NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "bad" },
        Networks.TESTNET,
      ),
    ).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/WalletConnect disabled/),
    );
  });
});
