/**
 * @jest-environment jsdom
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
import { useMultisigTransaction } from "../../src/templates/default/src/hooks/useMultisigTransaction";
import { buildMultisigTransaction } from "../../src/templates/default/src/lib/multisig";

const kp = (b: number) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, b));
const [source, alice, bob] = [kp(11), kp(12), kp(13)];

const account = {
  id: source.publicKey(),
  thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
  signers: [
    { key: alice.publicKey(), weight: 1, type: "ed25519_public_key" },
    { key: bob.publicKey(), weight: 1, type: "ed25519_public_key" },
  ],
};

function unsignedXdr() {
  return buildMultisigTransaction({
    source: new Account(source.publicKey(), "1"),
    operations: [
      Operation.payment({
        destination: alice.publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    ],
    networkPassphrase: Networks.TESTNET,
  }).toXDR();
}

describe("useMultisigTransaction (#1059)", () => {
  it("collects signatures until the threshold is met", () => {
    const { result } = renderHook(() =>
      useMultisigTransaction(account, Networks.TESTNET),
    );
    const xdr = unsignedXdr();

    act(() => {
      result.current.load(xdr);
    });
    expect(result.current.status?.requiredWeight).toBe(2);
    expect(result.current.thresholdMet).toBe(false);

    act(() => {
      result.current.signWith(alice);
    });
    const bobCopy = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    bobCopy.sign(bob);
    act(() => {
      result.current.addSignedXdr(bobCopy.toXDR());
    });

    expect(result.current.thresholdMet).toBe(true);
    expect(
      TransactionBuilder.fromXDR(result.current.xdr!, Networks.TESTNET)
        .signatures,
    ).toHaveLength(2);
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
  });
});
