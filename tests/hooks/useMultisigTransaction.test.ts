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

  describe("partial-signature recovery and merging", () => {
    it("recovers and merges partial signatures when XDR is re-imported across sessions", () => {
      // ────────────────────────────────────────────────────────────────────────────
      // Scenario: Simulate a workflow where a first signer creates a partial XDR,
      // then a second signer imports that XDR and adds their signature.
      // ────────────────────────────────────────────────────────────────────────────

      // Step 1: Initialize the first multisig session and load an unsigned transaction
      const { result: session1 } = renderHook(() =>
        useMultisigTransaction(account, Networks.TESTNET),
      );
      const unsignedXdrBase = unsignedXdr();

      act(() => {
        session1.current.load(unsignedXdrBase);
      });

      // Verify initial state: no signatures, threshold not met
      expect(session1.current.status?.signedWeight).toBe(0);
      expect(session1.current.status?.requiredWeight).toBe(2);
      expect(session1.current.thresholdMet).toBe(false);
      expect(session1.current.error).toBeNull();

      // Step 2: First signer (Alice) signs the transaction, producing a partially-signed XDR
      act(() => {
        session1.current.signWith(alice);
      });

      expect(session1.current.status?.signedWeight).toBe(1);
      expect(session1.current.thresholdMet).toBe(false);
      expect(session1.current.error).toBeNull();

      // Capture the XDR after Alice has signed (partial XDR with one signature)
      const partiallySignedXdrAfterAlice = session1.current.xdr;
      expect(partiallySignedXdrAfterAlice).toBeTruthy();

      // Verify it contains exactly one signature
      const txAfterAlice = TransactionBuilder.fromXDR(
        partiallySignedXdrAfterAlice!,
        Networks.TESTNET,
      );
      expect(txAfterAlice.signatures).toHaveLength(1);

      // Step 3: Simulate session end and disconnect. A new multisig session is
      // created (e.g., on a different device or after a page refresh) and loads
      // the partially-signed XDR from Step 2
      const { result: session2 } = renderHook(() =>
        useMultisigTransaction(account, Networks.TESTNET),
      );

      act(() => {
        session2.current.load(partiallySignedXdrAfterAlice!);
      });

      // Verify the new session has correctly recovered the prior signature
      expect(session2.current.status?.signedWeight).toBe(1);
      expect(session2.current.status?.requiredWeight).toBe(2);
      expect(session2.current.thresholdMet).toBe(false);
      expect(session2.current.error).toBeNull();

      // Verify the XDR still has Alice's signature
      expect(session2.current.xdr).toBe(partiallySignedXdrAfterAlice);
      const txLoaded = TransactionBuilder.fromXDR(session2.current.xdr!, Networks.TESTNET);
      expect(txLoaded.signatures).toHaveLength(1);

      // Step 4: Second signer (Bob) adds their signature to the partially-signed transaction
      act(() => {
        session2.current.signWith(bob);
      });

      // Verify signatures now accumulate correctly
      expect(session2.current.status?.signedWeight).toBe(2);
      expect(session2.current.status?.requiredWeight).toBe(2);
      expect(session2.current.thresholdMet).toBe(true);
      expect(session2.current.error).toBeNull();

      // Verify the final XDR contains both signatures (not just Bob's)
      const finalXdr = session2.current.xdr;
      expect(finalXdr).toBeTruthy();
      const txFinal = TransactionBuilder.fromXDR(finalXdr!, Networks.TESTNET);
      expect(txFinal.signatures).toHaveLength(2);

      // Step 5: Verify both Alice's and Bob's signatures are distinct and present
      // by checking they signed different things or with different keys
      const sig1 = txFinal.signatures[0];
      const sig2 = txFinal.signatures[1];
      expect(sig1.hint()).not.toEqual(sig2.hint());
    });

    it("preserves previously collected signatures when adding a co-signer's XDR", () => {
      // ────────────────────────────────────────────────────────────────────────────
      // Scenario: Verify that addSignedXdr correctly merges signatures without
      // losing previously collected ones.
      // ────────────────────────────────────────────────────────────────────────────

      const { result } = renderHook(() =>
        useMultisigTransaction(account, Networks.TESTNET),
      );
      const xdr = unsignedXdr();

      // Load the transaction and have Alice sign locally
      act(() => {
        result.current.load(xdr);
      });

      act(() => {
        result.current.signWith(alice);
      });

      // Verify Alice's signature is present
      expect(result.current.status?.signedWeight).toBe(1);
      const aliceSignatureCount = result.current.xdr
        ? TransactionBuilder.fromXDR(result.current.xdr, Networks.TESTNET).signatures
            .length
        : 0;
      expect(aliceSignatureCount).toBe(1);

      // Independently, Bob signs the original unsigned XDR
      const bobSignedTx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
      bobSignedTx.sign(bob);
      const bobSignedXdr = bobSignedTx.toXDR();

      // Add Bob's signed XDR via addSignedXdr
      act(() => {
        result.current.addSignedXdr(bobSignedXdr);
      });

      // Verify both signatures are now present and threshold is met
      expect(result.current.status?.signedWeight).toBe(2);
      expect(result.current.thresholdMet).toBe(true);
      expect(result.current.error).toBeNull();

      const finalTx = TransactionBuilder.fromXDR(result.current.xdr!, Networks.TESTNET);
      expect(finalTx.signatures).toHaveLength(2);
    });

    it("prevents duplicate signatures when the same XDR is added multiple times", () => {
      // ────────────────────────────────────────────────────────────────────────────
      // Scenario: If a co-signer's XDR is added multiple times (e.g., by accident),
      // duplicate signatures should not be accumulated.
      // ────────────────────────────────────────────────────────────────────────────

      const { result } = renderHook(() =>
        useMultisigTransaction(account, Networks.TESTNET),
      );
      const xdr = unsignedXdr();

      act(() => {
        result.current.load(xdr);
      });

      // Alice signs and we capture her signed XDR
      act(() => {
        result.current.signWith(alice);
      });
      const aliceSignedXdr = result.current.xdr;
      expect(aliceSignedXdr).toBeTruthy();

      // Verify state after Alice signs
      const sigCountAfterAlice = TransactionBuilder.fromXDR(
        aliceSignedXdr!,
        Networks.TESTNET,
      ).signatures.length;
      expect(sigCountAfterAlice).toBe(1);

      // Attempt to add Alice's same XDR again (simulating a duplicate import)
      act(() => {
        result.current.addSignedXdr(aliceSignedXdr!);
      });

      // Verify no duplicate signature was added
      const sigCountAfterDuplicate = TransactionBuilder.fromXDR(
        result.current.xdr!,
        Networks.TESTNET,
      ).signatures.length;
      expect(sigCountAfterDuplicate).toBe(1);
      expect(result.current.status?.signedWeight).toBe(1);
      expect(result.current.error).toBeNull();
    });

    it("rejects XDR from a different transaction", () => {
      // ────────────────────────────────────────────────────────────────────────────
      // Scenario: Ensure that attempting to merge an XDR from a different transaction
      // is rejected (hash mismatch).
      // ────────────────────────────────────────────────────────────────────────────

      const { result } = renderHook(() =>
        useMultisigTransaction(account, Networks.TESTNET),
      );
      const xdr1 = unsignedXdr();

      act(() => {
        result.current.load(xdr1);
      });

      // Build a different transaction with a different amount
      const differentTx = buildMultisigTransaction({
        source: new Account(source.publicKey(), "1"),
        operations: [
          Operation.payment({
            destination: bob.publicKey(),
            asset: Asset.native(),
            amount: "999", // Different amount
          }),
        ],
        networkPassphrase: Networks.TESTNET,
      });
      const differentTxSigned = differentTx.sign(alice);
      const differentXdr = differentTxSigned.toXDR();

      // Attempt to add the different transaction's XDR
      act(() => {
        result.current.addSignedXdr(differentXdr);
      });

      // Verify an error is reported
      expect(result.current.error).toBeTruthy();
      expect(result.current.error?.message).toMatch(/hash mismatch/);
      // Verify signatures were not modified
      expect(result.current.status?.signedWeight).toBe(0);
    });
  });
});
