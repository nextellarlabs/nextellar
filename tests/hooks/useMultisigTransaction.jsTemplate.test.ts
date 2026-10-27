/**
 * @jest-environment jsdom
 *
 * Targets the js-template port of useMultisigTransaction (#1239, plain JS,
 * no types). jest.config.mjs compiles the js-* templates' .js modules to CJS
 * specifically so this file's hook module loads under Jest. The TypeScript
 * default-template hook has its own coverage in useMultisigTransaction.test.ts.
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
import { useMultisigTransaction } from "../../src/templates/js-template/src/hooks/useMultisigTransaction.js";
import { buildMultisigTransaction } from "../../src/templates/js-template/src/lib/multisig.js";

const kp = (b: number) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, b));
const [source, alice, bob] = [kp(21), kp(22), kp(23)];

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

describe("useMultisigTransaction (js-template, #1239)", () => {
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
      TransactionBuilder.fromXDR(result.current.xdr, Networks.TESTNET)
        .signatures,
    ).toHaveLength(2);
  });

  it("a single signer reaching the low threshold does not meet the high (default) threshold", () => {
    const { result } = renderHook(() =>
      useMultisigTransaction(account, Networks.TESTNET),
    );
    act(() => {
      result.current.load(unsignedXdr());
      result.current.signWith(alice);
    });
    expect(result.current.status?.signedWeight).toBe(1);
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

  it("requires the account record", () => {
    const { result } = renderHook(() =>
      useMultisigTransaction(null, Networks.TESTNET),
    );
    act(() => {
      result.current.load(unsignedXdr());
    });
    expect(result.current.error?.message).toMatch(/signers\/thresholds/);
  });

  it("addSignature accepts a raw base64 signature from a known signer", () => {
    const { result } = renderHook(() =>
      useMultisigTransaction(account, Networks.TESTNET),
    );
    const xdr = unsignedXdr();
    act(() => {
      result.current.load(xdr);
    });

    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    const signatureBase64 = alice.sign(tx.hash()).toString("base64");

    act(() => {
      result.current.addSignature(alice.publicKey(), signatureBase64);
    });

    expect(result.current.status?.signedWeight).toBe(1);
    expect(result.current.error).toBeNull();
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
