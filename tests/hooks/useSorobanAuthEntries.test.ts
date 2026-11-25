/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";
import * as StellarSDK from "@stellar/stellar-sdk-v17";
import { act, renderHook } from "@testing-library/react";
const SDK = StellarSDK;
const { Address, Keypair, Networks, rpc, xdr } = SDK;
const mockAuthorizeEntry = jest.fn<typeof SDK.authorizeEntry>();
await jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
  ...SDK,
  authorizeEntry: mockAuthorizeEntry,
}));
const walletKitModule = `${process.cwd()}/src/templates/default/src/lib/stellar-wallet-kit.ts`;
const walletContextsModule = `${process.cwd()}/src/mocks/wallet-contexts-mock.ts`;
const mockUseWallet =
  jest.fn<
    () => { connected: boolean; publicKey?: string; networkMismatch?: boolean }
  >();

const mockSignAuthEntry =
  jest.fn<
    (
      preimageBase64: string,
      options: { address: string; networkPassphrase: string },
    ) => Promise<{ signedAuthEntry: string; signerAddress: string }>
  >();

await jest.unstable_mockModule(
  walletKitModule,
  () => ({
    kit: () => ({ signAuthEntry: mockSignAuthEntry }),
  }),
  { virtual: true },
);
await jest.unstable_mockModule(
  walletContextsModule,
  () => ({
    useWallet: mockUseWallet,
    useWalletConfig: () => undefined,
  }),
  { virtual: true },
);

const { useSorobanAuthEntries } =
  await import("../../src/templates/default/src/hooks/useSorobanAuthEntries.ts");

function renderWithWallet(publicKey: string) {
  mockUseWallet.mockReturnValue({
    connected: true,
    publicKey,
    networkMismatch: false,
  });
  return renderHook(() => useSorobanAuthEntries());
}

function buildEntry(
  invoker: string,
  credentialType: "legacy" | "v2" | "delegates" = "legacy",
): xdr.SorobanAuthorizationEntry {
  const addressCredentials = new xdr.SorobanAddressCredentials({
    address: new Address(invoker).toScAddress(),
    nonce: xdr.Int64(1n),
    signatureExpirationLedger: 0,
    signature: xdr.ScVal.scvVoid(),
  });
  const credentials =
    credentialType === "v2"
      ? xdr.SorobanCredentials.sorobanCredentialsAddressV2(addressCredentials)
      : credentialType === "delegates"
        ? xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(
            new xdr.SorobanAddressCredentialsWithDelegates({
              addressCredentials,
              delegates: [],
            }),
          )
        : xdr.SorobanCredentials.sorobanCredentialsAddress(addressCredentials);
  const rootInvocation = new xdr.SorobanAuthorizedInvocation({
    function:
      xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: Address.contract(Buffer.alloc(32, 7)).toScAddress(),
          functionName: "authorize",
          args: [],
        }),
      ),
    subInvocations: [],
  });
  return new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation });
}

describe("useSorobanAuthEntries", () => {
  let signingKey: InstanceType<typeof Keypair>;

  beforeEach(() => {
    jest.clearAllMocks();
    signingKey = Keypair.random();
    mockAuthorizeEntry.mockImplementation(async (entry, signer) => {
      const preimage = {
        toXDR: () => new Uint8Array([1, 2, 3]),
      } as Parameters<Parameters<typeof SDK.authorizeEntry>[1]>[0];
      if (typeof signer === "function") await signer(preimage);
      return entry;
    });
    mockSignAuthEntry.mockImplementation(async () => ({
      signedAuthEntry: "AQID",
      signerAddress: signingKey.publicKey(),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("signs the connected account entry with an expiration 100 ledgers ahead", async () => {
    const getLatestLedger = jest
      .spyOn(rpc.Server.prototype, "getLatestLedger")
      .mockResolvedValue({ sequence: 123 } as never);
    const entry = buildEntry(signingKey.publicKey());
    const { result } = renderWithWallet(signingKey.publicKey());

    let signedEntries: xdr.SorobanAuthorizationEntry[] = [];
    await act(async () => {
      signedEntries = await result.current.signAuthEntries([entry]);
    });

    expect(getLatestLedger).toHaveBeenCalledTimes(1);
    expect(mockSignAuthEntry).toHaveBeenCalledTimes(1);
    expect(mockSignAuthEntry.mock.calls[0][1]).toEqual({
      address: signingKey.publicKey(),
      networkPassphrase: Networks.TESTNET,
    });
    expect(signedEntries).toEqual([entry]);
    expect(mockAuthorizeEntry).toHaveBeenCalledWith(
      entry,
      expect.any(Function),
      223,
      Networks.TESTNET,
      signingKey.publicKey(),
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it.each(["v2", "delegates"] as const)(
    "signs %s authorization credentials",
    async (credentialType) => {
      jest
        .spyOn(rpc.Server.prototype, "getLatestLedger")
        .mockResolvedValue({ sequence: 456 } as never);
      const { result } = renderWithWallet(signingKey.publicKey());

      let signedEntries: xdr.SorobanAuthorizationEntry[] = [];
      await act(async () => {
        signedEntries = await result.current.signAuthEntries([
          buildEntry(signingKey.publicKey(), credentialType),
        ]);
      });

      expect(signedEntries[0].credentials.type).toBe(
        credentialType === "v2"
          ? "sorobanCredentialsAddressV2"
          : "sorobanCredentialsAddressWithDelegates",
      );
      expect(mockAuthorizeEntry).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Function),
        556,
        Networks.TESTNET,
        signingKey.publicKey(),
      );
      expect(mockSignAuthEntry).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects entries whose invoker is not the connected account", async () => {
    const getLatestLedger = jest.spyOn(rpc.Server.prototype, "getLatestLedger");
    const entry = buildEntry(Keypair.random().publicKey());
    const { result } = renderWithWallet(signingKey.publicKey());

    await act(async () => {
      await expect(result.current.signAuthEntries([entry])).rejects.toThrow(
        "does not match the connected account",
      );
    });

    expect(getLatestLedger).not.toHaveBeenCalled();
    expect(mockSignAuthEntry).not.toHaveBeenCalled();
    expect(result.current.error?.message).toContain(
      "does not match the connected account",
    );
    expect(result.current.loading).toBe(false);
  });

  it("surfaces Soroban RPC failures in error state", async () => {
    jest
      .spyOn(rpc.Server.prototype, "getLatestLedger")
      .mockRejectedValue(new Error("RPC unavailable"));
    const entry = buildEntry(signingKey.publicKey());
    const { result } = renderWithWallet(signingKey.publicKey());

    await act(async () => {
      await expect(result.current.signAuthEntries([entry])).rejects.toThrow(
        "RPC unavailable",
      );
    });

    expect(mockSignAuthEntry).not.toHaveBeenCalled();
    expect(result.current.error?.message).toBe("RPC unavailable");
    expect(result.current.loading).toBe(false);
  });
});
