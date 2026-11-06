/**
 * @jest-environment jsdom
 *
 * Targets the defi-template port of useMultisigTransaction (#1224). The hook
 * mirrors the default template's version and relies on the defi template's
 * copy of lib/multisig, which is exercised below as well.
 */
import { act, renderHook } from "@testing-library/react";
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { useMultisigTransaction } from "../../src/templates/defi/src/hooks/useMultisigTransaction";
import { buildMultisigTransaction } from "../../src/templates/defi/src/lib/multisig";

const kp = (b: number) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, b));
const [source, alice, bob, carol] = [kp(31), kp(32), kp(33), kp(34)];

const account = {
  id: source.publicKey(),
  thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
  signers: [
    { key: alice.publicKey(), weight: 1, type: "ed25519_public_key" },
    { key: bob.publicKey(), weight: 1, type: "ed25519_public_key" },
    { key: carol.publicKey(), weight: 1, type: "ed25519_public_key" },
  ],
};

function unsignedXdr(destination = alice.publicKey()) {
  return buildMultisigTransaction({
    source: new Account(source.publicKey(), "1"),
    operations: [
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount: "1",
      }),
    ],
    networkPassphrase: Networks.TESTNET,
  }).toXDR();
}

describe("useMultisigTransaction defi template (#1224)", () => {
  it("collects signatures until the threshold is met", () => {
    const { result } = renderHook(() =>
      useMultisigTransaction(account, Networks.TESTNET),
    );
    const xdr = unsignedXdr();

    act(() => {
      result.current.load(xdr);
    });
    expect(result.current.status?.thresholdLevel).toBe("medium");
    expect(result.current.status?.requiredWeight).toBe(2);
    expect(result.current.thresholdMet).toBe(false);

    act(() => {
      result.current.signWith(alice);
    });
    expect(result.current.thresholdMet).toBe(false);
    expect(result.current.status?.pendingSigners.map((s) => s.key)).toEqual([
      bob.publicKey(),
      carol.publicKey(),
    ]);

    const bobCopy = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    bobCopy.sign(bob);
    act(() => {
      result.current.addSignedXdr(bobCopy.toXDR());
    });

    expect(result.current.thresholdMet).toBe(true);
    expect(result.current.status?.signedWeight).toBe(2);
    expect(
      TransactionBuilder.fromXDR(result.current.xdr!, Networks.TESTNET)
        .signatures,
    ).toHaveLength(2);
  });

  it("does not double-count a signature merged twice", () => {
    const { result } = renderHook(() =>
      useMultisigTransaction(account, Networks.TESTNET),
    );
    const xdr = unsignedXdr();

    act(() => {
      result.current.load(xdr);
    });
    const aliceCopy = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    aliceCopy.sign(alice);

    act(() => {
      result.current.addSignedXdr(aliceCopy.toXDR());
      result.current.addSignedXdr(aliceCopy.toXDR());
    });

    expect(result.current.status?.signedWeight).toBe(1);
    expect(
      TransactionBuilder.fromXDR(result.current.xdr!, Networks.TESTNET)
        .signatures,
    ).toHaveLength(1);
  });

  it("honours an explicit threshold level override", () => {
    const { result } = renderHook(() =>
      useMultisigTransaction(account, Networks.TESTNET),
    );

    act(() => {
      result.current.load(unsignedXdr(), { thresholdLevel: "high" });
    });

    expect(result.current.status?.thresholdLevel).toBe("high");
    expect(result.current.status?.requiredWeight).toBe(3);
    expect(result.current.thresholdMet).toBe(false);
  });

  it("exposes errors instead of throwing", () => {
    const { result } = renderHook(() =>
      useMultisigTransaction(account, Networks.TESTNET),
    );
    act(() => {
      result.current.addSignedXdr("x");
    });
    expect(result.current.error?.message).toMatch(/load\(\) first/);

    act(() => {
      result.current.load("garbage");
    });
    expect(result.current.error?.message).toMatch(/Invalid transaction XDR/);
    expect(result.current.status).toBeNull();
  });

  it("rejects a signed copy of a different transaction", () => {
    const { result } = renderHook(() =>
      useMultisigTransaction(account, Networks.TESTNET),
    );

    act(() => {
      result.current.load(unsignedXdr());
    });

    const other = TransactionBuilder.fromXDR(
      unsignedXdr(bob.publicKey()),
      Networks.TESTNET,
    );
    other.sign(bob);

    act(() => {
      result.current.addSignedXdr(other.toXDR());
    });

    expect(result.current.error?.message).toMatch(/different transaction/);
    expect(result.current.status?.signedWeight).toBe(0);
  });

  it("requires the account record", () => {
    const { result } = renderHook(() =>
      useMultisigTransaction(null, Networks.TESTNET),
    );
    act(() => {
      result.current.load(unsignedXdr());
    });
    expect(result.current.error?.message).toMatch(/signers\/thresholds/);
  });

  it("reset clears everything", () => {
    const { result } = renderHook(() =>
      useMultisigTransaction(account, Networks.TESTNET),
    );
    act(() => {
      result.current.load(unsignedXdr());
      result.current.reset();
    });
    expect(result.current.status).toBeNull();
    expect(result.current.xdr).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
