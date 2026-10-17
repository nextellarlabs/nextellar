import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  hash,
} from "@stellar/stellar-sdk";
import {
  DEFAULT_LEDGER_PATH,
  LEDGER_WALLET_ID,
  LedgerError,
  LedgerWalletModule,
  mapLedgerError,
  type LedgerStellarApp,
  type LedgerTransport,
} from "../../src/templates/default/src/lib/wallets/ledger-module";

const NETWORK = { network: "TESTNET", networkPassphrase: Networks.TESTNET };
const device = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 42));

function unsignedXdr() {
  return new TransactionBuilder(new Account(device.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: device.publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(60)
    .build()
    .toXDR();
}

/**
 * Mocked Ledger transport + Stellar app. The "device" signs the hash of the
 * signature base with a real keypair, like the Ledger Stellar app does.
 */
function mockedLedger(overrides: Partial<LedgerStellarApp> = {}) {
  const transport: LedgerTransport & { close: jest.Mock } = {
    close: jest.fn(async () => undefined),
  };
  const app: LedgerStellarApp = {
    getPublicKey: jest.fn(async () => ({
      rawPublicKey: device.rawPublicKey(),
    })),
    signTransaction: jest.fn(async (_path: string, base: Uint8Array) => ({
      signature: device.sign(hash(Buffer.from(base))),
    })),
    ...overrides,
  };
  const createTransport = jest.fn(async () => transport);
  const createApp = jest.fn(() => app);
  const module = new LedgerWalletModule({
    network: NETWORK,
    createTransport,
    createApp,
    isSupported: () => true,
  });
  return { module, app, transport, createTransport, createApp };
}

describe("LedgerWalletModule (#1065)", () => {
  it("implements the adapter metadata", async () => {
    const { module } = mockedLedger();
    expect(module.productId).toBe(LEDGER_WALLET_ID);
    expect(module.moduleType).toBe("HW_WALLET");
    expect(await module.isPlatformWrapper()).toBe(false);
  });

  it("is unavailable without WebUSB and never touches the device to find out", async () => {
    const createTransport = jest.fn();
    const module = new LedgerWalletModule({
      network: NETWORK,
      createTransport,
      isSupported: () => false,
    });
    expect(await module.isAvailable()).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
    await expect(module.getAddress()).rejects.toMatchObject({
      code: "NOT_SUPPORTED",
    });
  });

  it("reads the address on the default SEP-0005 path and closes the transport", async () => {
    const { module, app, transport } = mockedLedger();
    await expect(module.getAddress()).resolves.toEqual({
      address: device.publicKey(),
    });
    expect(app.getPublicKey).toHaveBeenCalledWith(
      DEFAULT_LEDGER_PATH,
      true,
      false,
    );
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("accepts the older hw-app-str response shape ({ publicKey })", async () => {
    const { module } = mockedLedger({
      getPublicKey: jest.fn(async () => ({ publicKey: device.publicKey() })),
    });
    await expect(module.getAddress({ path: "44'/148'/1'" })).resolves.toEqual({
      address: device.publicKey(),
    });
  });

  it("signs a transaction with the device and returns a verifiable envelope", async () => {
    const { module, app } = mockedLedger();
    const { signedTxXdr, signerAddress } = await module.signTransaction(
      unsignedXdr(),
      {
        networkPassphrase: Networks.TESTNET,
      },
    );

    expect(signerAddress).toBe(device.publicKey());
    const signed = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
    expect(signed.signatures).toHaveLength(1);
    expect(device.verify(signed.hash(), signed.signatures[0].signature())).toBe(
      true,
    );
    const [path, base] = (app.signTransaction as jest.Mock).mock.calls[0];
    expect(path).toBe(DEFAULT_LEDGER_PATH);
    expect(Buffer.from(base).equals(signed.signatureBase())).toBe(true);
  });

  it("refuses to sign when the requested signer is not on the device path", async () => {
    const { module, app } = mockedLedger();
    await expect(
      module.signTransaction(unsignedXdr(), {
        address: Keypair.random().publicKey(),
      }),
    ).rejects.toThrow(/not the requested signer/);
    expect(app.signTransaction).not.toHaveBeenCalled();
  });

  it.each([
    [
      { statusCode: 0x6985, message: "Condition of use not satisfied" },
      "REJECTED",
    ],
    [{ statusCode: 0x5515, message: "Locked device" }, "LOCKED"],
    [{ statusCode: 0x6e00, message: "CLA_NOT_SUPPORTED" }, "APP_NOT_OPEN"],
    [new Error("USB disconnected"), "UNKNOWN"],
  ])(
    "maps device error %j to %s and still closes the transport",
    async (deviceError, code) => {
      const { module, transport } = mockedLedger({
        signTransaction: jest.fn(async () => {
          throw deviceError;
        }),
      });
      await expect(module.signTransaction(unsignedXdr())).rejects.toMatchObject(
        { name: "LedgerError", code },
      );
      expect(transport.close).toHaveBeenCalled();
    },
  );

  it("serialises concurrent requests (one APDU exchange at a time)", async () => {
    let active = 0;
    let maxActive = 0;
    const { module } = mockedLedger({
      getPublicKey: jest.fn(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
        return { rawPublicKey: device.rawPublicKey() };
      }),
    });
    await Promise.all([
      module.getAddress(),
      module.getAddress(),
      module.getAddress(),
    ]);
    expect(maxActive).toBe(1);
  });

  it("keeps working after a failed request", async () => {
    const getPublicKey = jest
      .fn()
      .mockRejectedValueOnce({ statusCode: 0x6985, message: "denied" })
      .mockResolvedValue({ rawPublicKey: device.rawPublicKey() });
    const { module } = mockedLedger({ getPublicKey });
    await expect(module.getAddress()).rejects.toBeInstanceOf(LedgerError);
    await expect(module.getAddress()).resolves.toEqual({
      address: device.publicKey(),
    });
  });

  it("signs Soroban auth entries when the app supports it", async () => {
    const signSorobanAuthorization = jest.fn(async () => ({
      signature: Buffer.from("sig"),
    }));
    const { module } = mockedLedger({ signSorobanAuthorization });
    const entry = Buffer.from("preimage").toString("base64");
    await expect(module.signAuthEntry(entry)).resolves.toEqual({
      signedAuthEntry: Buffer.from("sig").toString("base64"),
      signerAddress: device.publicKey(),
    });
    expect(
      Buffer.from(signSorobanAuthorization.mock.calls[0][1]).toString(),
    ).toBe("preimage");
  });

  it("reports unsupported auth-entry and message signing clearly", async () => {
    const { module } = mockedLedger();
    await expect(module.signAuthEntry("AAAA")).rejects.toMatchObject({
      code: "NOT_SUPPORTED",
    });
    await expect(module.signMessage()).rejects.toMatchObject({
      code: "NOT_SUPPORTED",
    });
  });

  it("reports the configured network", async () => {
    const { module } = mockedLedger();
    await expect(module.getNetwork()).resolves.toEqual(NETWORK);
  });

  it("passes LedgerErrors through mapLedgerError unchanged", () => {
    const err = new LedgerError("LOCKED", "x");
    expect(mapLedgerError(err)).toBe(err);
  });
});
