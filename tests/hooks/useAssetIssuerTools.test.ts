/**
 * @jest-environment jsdom
 *
 * Unit tests for `useAssetIssuerTools` template hook.
 *
 * Imports the real hook and stubs only the Horizon network boundary via
 * `src/mocks/stellar-horizon-mock.ts`, leaving `Keypair`, `Asset`,
 * `Operation`, `TransactionBuilder`, and `Transaction` as the genuine
 * `@stellar/stellar-sdk` implementations.
 */

import { jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";

const {
  mockLoadAccount,
  mockSubmitTransaction,
  mockHorizonServerConstructor,
  resetHorizonMocks,
  createHorizonMock,
} = await import("../../src/mocks/stellar-horizon-mock.js");

await jest.unstable_mockModule("@stellar/stellar-sdk", async () => {
  const actual = await jest.requireActual<Record<string, unknown>>(
    "@stellar/stellar-sdk",
  );
  return createHorizonMock(actual);
});

const { Keypair, Account, Transaction, Networks } =
  (await import("@stellar/stellar-sdk")) as unknown as typeof import("@stellar/stellar-sdk");

const { useAssetIssuerTools, ISSUER_AUTH_FLAG_VALUES } =
  await import("../../src/templates/default/src/hooks/useAssetIssuerTools.js");

// ── Fixtures ────────────────────────────────────────────────────────────────

const ISSUER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
const ISSUER_PK = ISSUER_KP.publicKey();
const ISSUER_SECRET = ISSUER_KP.secret();

const HOLDER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 17));
const HOLDER_PK = HOLDER_KP.publicKey();

const OTHER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 29));

function makeIssuerAccount() {
  return new Account(ISSUER_PK, "10");
}

function signTx(unsignedXdr: string, networkPassphrase = Networks.TESTNET) {
  const tx = new Transaction(unsignedXdr, networkPassphrase);
  tx.sign(ISSUER_KP);
  return tx.toXDR();
}

describe("useAssetIssuerTools", () => {
  beforeEach(() => {
    resetHorizonMocks();
    mockLoadAccount.mockResolvedValue(makeIssuerAccount());
    mockSubmitTransaction.mockResolvedValue({
      hash: "abc123issuerhash",
      ledger: 12345,
    });
  });

  // ── Happy paths ───────────────────────────────────────────────────────────

  it("builds a setOptions XDR for reversible authorization flags and submits it", async () => {
    const { result } = renderHook(() => useAssetIssuerTools(ISSUER_PK));

    let xdr = "";
    await act(async () => {
      xdr = await result.current.buildSetFlagsXDR({
        setFlags: ["AUTH_REQUIRED", "AUTH_REVOCABLE", "AUTH_CLAWBACK_ENABLED"],
      });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();

    const parsed = new Transaction(xdr, Networks.TESTNET);
    expect(parsed.operations).toHaveLength(1);
    const op = parsed.operations[0] as unknown as {
      type: string;
      setFlags?: number;
      clearFlags?: number;
    };
    expect(op.type).toBe("setOptions");
    expect(op.setFlags).toBe(
      ISSUER_AUTH_FLAG_VALUES.AUTH_REQUIRED |
        ISSUER_AUTH_FLAG_VALUES.AUTH_REVOCABLE |
        ISSUER_AUTH_FLAG_VALUES.AUTH_CLAWBACK_ENABLED,
    );
    expect(op.clearFlags).toBeUndefined();

    let submitRes: Awaited<ReturnType<typeof result.current.submitSignedXDR>>;
    await act(async () => {
      submitRes = await result.current.submitSignedXDR(signTx(xdr));
    });

    expect(submitRes!.success).toBe(true);
    expect(submitRes!.txHash).toBe("abc123issuerhash");
    expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
  });

  it("allows AUTH_IMMUTABLE when confirmIrreversible: true is explicitly passed", async () => {
    const { result } = renderHook(() => useAssetIssuerTools(ISSUER_PK));

    let xdr = "";
    await act(async () => {
      xdr = await result.current.buildSetFlagsXDR({
        setFlags: ["AUTH_IMMUTABLE"],
        confirmIrreversible: true,
      });
    });

    const parsed = new Transaction(xdr, Networks.TESTNET);
    const op = parsed.operations[0] as unknown as {
      type: string;
      setFlags?: number;
    };
    expect(op.type).toBe("setOptions");
    expect(op.setFlags).toBe(ISSUER_AUTH_FLAG_VALUES.AUTH_IMMUTABLE);
    expect(result.current.error).toBeNull();
  });

  it("builds a clawback XDR for an issued asset", async () => {
    const { result } = renderHook(() => useAssetIssuerTools(ISSUER_PK));

    let xdr = "";
    await act(async () => {
      xdr = await result.current.buildClawbackXDR({
        assetCode: "USDC",
        from: HOLDER_PK,
        amount: "42.5000000",
      });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();

    const parsed = new Transaction(xdr, Networks.TESTNET);
    expect(parsed.operations).toHaveLength(1);
    const op = parsed.operations[0] as unknown as {
      type: string;
      asset: { code: string; issuer: string };
      from: string;
      amount: string;
    };
    expect(op.type).toBe("clawback");
    expect(op.asset.code).toBe("USDC");
    expect(op.asset.issuer).toBe(ISSUER_PK);
    expect(op.from).toBe(HOLDER_PK);
    expect(op.amount).toBe("42.5000000");
  });

  it("builds a setTrustLineFlags XDR to authorize and clear clawback on a trustline", async () => {
    const { result } = renderHook(() =>
      useAssetIssuerTools(ISSUER_PK, {
        horizonUrl: "https://horizon.stellar.org",
        network: "PUBLIC",
      }),
    );

    expect(mockHorizonServerConstructor).toHaveBeenCalledWith(
      "https://horizon.stellar.org",
    );

    let xdr = "";
    await act(async () => {
      xdr = await result.current.buildSetTrustLineFlagsXDR({
        trustor: HOLDER_PK,
        assetCode: "USDC",
        flags: {
          authorized: true,
          clawbackEnabled: false,
        },
      });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();

    const parsed = new Transaction(xdr, Networks.PUBLIC);
    expect(parsed.operations).toHaveLength(1);
    const op = parsed.operations[0] as unknown as {
      type: string;
      trustor: string;
      asset: { code: string; issuer: string };
      flags: { authorized?: boolean; clawbackEnabled?: boolean };
    };
    expect(op.type).toBe("setTrustLineFlags");
    expect(op.trustor).toBe(HOLDER_PK);
    expect(op.asset.code).toBe("USDC");
    expect(op.asset.issuer).toBe(ISSUER_PK);
    expect(op.flags.authorized).toBe(true);
    expect(op.flags.clawbackEnabled).toBe(false);
  });

  it("signs and submits with submitWithSecret in dev mode", async () => {
    const { result } = renderHook(() => useAssetIssuerTools(ISSUER_PK));

    let xdr = "";
    await act(async () => {
      xdr = await result.current.buildClawbackXDR({
        assetCode: "USDC",
        from: HOLDER_PK,
        amount: "10",
      });
    });

    let submitRes: Awaited<ReturnType<typeof result.current.submitWithSecret>>;
    await act(async () => {
      submitRes = await result.current.submitWithSecret(xdr, ISSUER_SECRET);
    });

    expect(submitRes!.success).toBe(true);
    expect(submitRes!.txHash).toBe("abc123issuerhash");
  });

  // ── Failure modes ─────────────────────────────────────────────────────────

  it("refuses irreversible AUTH_IMMUTABLE flag without confirmIrreversible: true", async () => {
    const { result } = renderHook(() => useAssetIssuerTools(ISSUER_PK));

    await act(async () => {
      await expect(
        result.current.buildSetFlagsXDR({
          setFlags: ["AUTH_REQUIRED", "AUTH_IMMUTABLE"],
        }),
      ).rejects.toThrow(/AUTH_IMMUTABLE.*irreversible/i);
    });

    expect(mockLoadAccount).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.error?.message).toMatch(/AUTH_IMMUTABLE/i);
  });

  it("surfaces Horizon loadAccount 404 errors and sets error state", async () => {
    mockLoadAccount.mockRejectedValueOnce(
      Object.assign(new Error("Not Found"), { response: { status: 404 } }),
    );

    const { result } = renderHook(() => useAssetIssuerTools(ISSUER_PK));

    await act(async () => {
      await expect(
        result.current.buildClawbackXDR({
          assetCode: "USDC",
          from: HOLDER_PK,
          amount: "5",
        }),
      ).rejects.toThrow(/not found/i);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error?.message).toMatch(/not found/i);

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  it("decodes Horizon submission rejection result codes and sets error state", async () => {
    mockSubmitTransaction.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          extras: {
            result_codes: {
              transaction: "tx_failed",
              operations: ["op_not_authorized"],
            },
          },
        },
      },
    });

    const { result } = renderHook(() => useAssetIssuerTools(ISSUER_PK));

    let xdr = "";
    await act(async () => {
      xdr = await result.current.buildSetTrustLineFlagsXDR({
        trustor: HOLDER_PK,
        assetCode: "USDC",
        flags: { authorized: true },
      });
    });

    let submitRes: Awaited<ReturnType<typeof result.current.submitSignedXDR>>;
    await act(async () => {
      submitRes = await result.current.submitSignedXDR(signTx(xdr));
    });

    expect(submitRes!.success).toBe(false);
    expect(submitRes!.resultCodes).toEqual({
      transaction: "tx_failed",
      operations: ["op_not_authorized"],
    });
    expect(submitRes!.error).toBeTruthy();
    expect(result.current.error).not.toBeNull();
  });

  it("rejects mismatched secret key in submitWithSecret", async () => {
    const { result } = renderHook(() => useAssetIssuerTools(ISSUER_PK));

    let submitRes: Awaited<ReturnType<typeof result.current.submitWithSecret>>;
    await act(async () => {
      submitRes = await result.current.submitWithSecret(
        "AAAA...",
        OTHER_KP.secret(),
      );
    });

    expect(submitRes!.success).toBe(false);
    expect(submitRes!.error).toMatch(/does not match/i);
    expect(mockSubmitTransaction).not.toHaveBeenCalled();
  });
});
