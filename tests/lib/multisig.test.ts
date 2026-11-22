import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  hash,
  xdr,
} from "@stellar/stellar-sdk";
import {
  buildMultisigTransaction,
  createMultisigSession,
  evaluateSignatures,
  MultisigError,
  requiredWeightFor,
  thresholdLevelForOperation,
  thresholdLevelForTransaction,
  type MultisigAccount,
} from "../../src/templates/default/src/lib/multisig";

const PASSPHRASE = Networks.TESTNET;

/** Deterministic keypairs so failures are reproducible. */
const kp = (seedByte: number) =>
  Keypair.fromRawEd25519Seed(Buffer.alloc(32, seedByte));
const master = kp(1);
const alice = kp(2);
const bob = kp(3);
const carol = kp(4);
const outsider = kp(5);

/** Mocked Horizon account: 2-of-3 for payments (med 2), 3 for admin ops (high 3). */
function multiSignerAccount(
  overrides: Partial<MultisigAccount> = {},
): MultisigAccount {
  return {
    id: master.publicKey(),
    thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
    signers: [
      { key: master.publicKey(), weight: 0, type: "ed25519_public_key" },
      { key: alice.publicKey(), weight: 1, type: "ed25519_public_key" },
      { key: bob.publicKey(), weight: 1, type: "ed25519_public_key" },
      { key: carol.publicKey(), weight: 1, type: "ed25519_public_key" },
    ],
    ...overrides,
  };
}

function paymentTx(
  ops = [
    Operation.payment({
      destination: outsider.publicKey(),
      asset: Asset.native(),
      amount: "10",
    }),
  ],
) {
  return buildMultisigTransaction({
    source: new Account(master.publicKey(), "100"),
    operations: ops,
    networkPassphrase: PASSPHRASE,
  });
}

/** What a co-signer's wallet hands back: the same tx, signed by them. */
function signedCopy(xdr: string, ...signers: Keypair[]): string {
  const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASE);
  signers.forEach((s) => tx.sign(s));
  return tx.toXDR();
}

describe("multisig (#1059)", () => {
  describe("threshold levels", () => {
    it("classifies operations per Stellar's threshold table", () => {
      expect(thresholdLevelForOperation({ type: "payment" })).toBe("medium");
      expect(thresholdLevelForOperation({ type: "bumpSequence" })).toBe("low");
      expect(thresholdLevelForOperation({ type: "allowTrust" })).toBe("low");
      expect(thresholdLevelForOperation({ type: "accountMerge" })).toBe("high");
      expect(
        thresholdLevelForOperation({ type: "setOptions", homeDomain: "x" }),
      ).toBe("medium");
      expect(
        thresholdLevelForOperation({ type: "setOptions", signer: {} }),
      ).toBe("high");
      expect(
        thresholdLevelForOperation({ type: "setOptions", medThreshold: 2 }),
      ).toBe("high");
    });

    it("uses the highest level across operations", () => {
      const tx = paymentTx([
        Operation.bumpSequence({ bumpTo: "200" }),
        Operation.setOptions({
          signer: { ed25519PublicKey: outsider.publicKey(), weight: 1 },
        }),
      ]);
      expect(thresholdLevelForTransaction(tx)).toBe("high");
    });

    it("treats a zero threshold as needing weight 1", () => {
      const account = multiSignerAccount({
        thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
      });
      expect(requiredWeightFor(account, "medium")).toBe(1);
      expect(requiredWeightFor(multiSignerAccount(), "high")).toBe(3);
    });
  });

  describe("createMultisigSession", () => {
    it("tracks signers and detects when the 2-of-3 threshold is met", () => {
      const unsigned = paymentTx().toXDR();
      const session = createMultisigSession({
        transaction: unsigned,
        networkPassphrase: PASSPHRASE,
        account: multiSignerAccount(),
      });

      let status = session.status();
      expect(status).toMatchObject({
        thresholdLevel: "medium",
        requiredWeight: 2,
        signedWeight: 0,
        thresholdMet: false,
      });
      expect(status.pendingSigners.map((s) => s.key)).toEqual(
        [alice, bob, carol].map((k) => k.publicKey()),
      );

      status = session.addSignedXdr(signedCopy(unsigned, alice));
      expect(status.signedWeight).toBe(1);
      expect(status.thresholdMet).toBe(false);

      status = session.addSignedXdr(signedCopy(unsigned, bob));
      expect(status.signedWeight).toBe(2);
      expect(status.thresholdMet).toBe(true);
      expect(status.pendingSigners.map((s) => s.key)).toEqual([
        carol.publicKey(),
      ]);

      // The merged envelope carries both signatures and verifies.
      const merged = TransactionBuilder.fromXDR(session.toXDR(), PASSPHRASE);
      expect(merged.signatures).toHaveLength(2);
      expect(
        evaluateSignatures(merged, multiSignerAccount()).thresholdMet,
      ).toBe(true);
    });

    it("does not double count a signer who signs twice", () => {
      const unsigned = paymentTx().toXDR();
      const session = createMultisigSession({
        transaction: unsigned,
        networkPassphrase: PASSPHRASE,
        account: multiSignerAccount(),
      });
      session.addSignedXdr(signedCopy(unsigned, alice));
      const status = session.addSignedXdr(signedCopy(unsigned, alice));
      expect(status.signedWeight).toBe(1);
      expect(session.transaction.signatures).toHaveLength(1);
    });

    it("needs the high threshold for signer changes", () => {
      const tx = paymentTx([
        Operation.setOptions({
          signer: { ed25519PublicKey: outsider.publicKey(), weight: 1 },
        }),
      ]);
      const session = createMultisigSession({
        transaction: tx,
        networkPassphrase: PASSPHRASE,
        account: multiSignerAccount(),
      });
      session.signWith(alice);
      expect(session.signWith(bob).thresholdMet).toBe(false);
      expect(session.signWith(carol)).toMatchObject({
        thresholdLevel: "high",
        signedWeight: 3,
        thresholdMet: true,
      });
    });

    it("reports signatures from non-signers as unknown and does not count them", () => {
      const session = createMultisigSession({
        transaction: paymentTx(),
        networkPassphrase: PASSPHRASE,
        account: multiSignerAccount(),
      });
      session.signWith(alice);
      const status = session.signWith(outsider);
      expect(status.signedWeight).toBe(1);
      expect(status.unknownSignatures).toBe(1);
    });

    it("ignores a forged signature that reuses a signer's hint", () => {
      const tx = paymentTx();
      const session = createMultisigSession({
        transaction: tx,
        networkPassphrase: PASSPHRASE,
        account: multiSignerAccount(),
      });
      // Outsider signs, then we relabel the signature with Alice's hint.
      const forged = TransactionBuilder.fromXDR(tx.toXDR(), PASSPHRASE);
      forged.sign(outsider);
      const sig = forged.signatures[0];
      const decorated = new xdr.DecoratedSignature({
        hint: alice.signatureHint(),
        signature: sig.signature(),
      });
      session.transaction.signatures.push(decorated);
      expect(session.status().signedWeight).toBe(0);
    });

    it("rejects a signed copy of a different transaction", () => {
      const session = createMultisigSession({
        transaction: paymentTx(),
        networkPassphrase: PASSPHRASE,
        account: multiSignerAccount(),
      });
      const other = buildMultisigTransaction({
        source: new Account(master.publicKey(), "500"),
        operations: [Operation.bumpSequence({ bumpTo: "900" })],
        networkPassphrase: PASSPHRASE,
      });
      other.sign(alice);
      expect(() => session.addSignedXdr(other.toXDR())).toThrow(MultisigError);
    });

    it("rejects invalid XDR and invalid raw signatures", () => {
      expect(() =>
        createMultisigSession({
          transaction: "not-xdr",
          networkPassphrase: PASSPHRASE,
          account: multiSignerAccount(),
        }),
      ).toThrow(MultisigError);

      const session = createMultisigSession({
        transaction: paymentTx(),
        networkPassphrase: PASSPHRASE,
        account: multiSignerAccount(),
      });
      const bogus = Buffer.alloc(64, 7).toString("base64");
      expect(() => session.addSignature(alice.publicKey(), bogus)).toThrow(
        MultisigError,
      );
    });

    it("accepts a raw signature produced elsewhere (e.g. a hardware wallet)", () => {
      const tx = paymentTx();
      const session = createMultisigSession({
        transaction: tx,
        networkPassphrase: PASSPHRASE,
        account: multiSignerAccount(),
      });
      const signature = bob.sign(tx.hash()).toString("base64");
      expect(
        session.addSignature(bob.publicKey(), signature).signedWeight,
      ).toBe(1);
    });

    it("counts pre-authorized transaction and hash(x) signers", () => {
      const tx = paymentTx();
      const preimage = Buffer.from("open sesame");
      const account = multiSignerAccount({
        signers: [
          {
            key: StrKey.encodePreAuthTx(tx.hash()),
            weight: 1,
            type: "preauth_tx",
          },
          {
            key: StrKey.encodeSha256Hash(hash(preimage)),
            weight: 1,
            type: "sha256_hash",
          },
          {
            key: "PBADSIGNEDPAYLOAD",
            weight: 5,
            type: "ed25519_signed_payload",
          },
        ],
      });
      const session = createMultisigSession({
        transaction: tx,
        networkPassphrase: PASSPHRASE,
        account,
      });
      expect(session.status().signedWeight).toBe(1); // preauth counts immediately

      tx.signHashX(preimage);
      const status = session.status();
      expect(status.signedWeight).toBe(2);
      expect(status.thresholdMet).toBe(true);
      expect(
        status.signers.find((s) => s.type === "ed25519_signed_payload"),
      ).toMatchObject({ supported: false, signed: false });
    });

    it("lets the caller override the threshold level", () => {
      const session = createMultisigSession({
        transaction: paymentTx(),
        networkPassphrase: PASSPHRASE,
        account: multiSignerAccount(),
        thresholdLevel: "low",
      });
      expect(session.signWith(alice).thresholdMet).toBe(true);
    });
  });

  it("requires at least one operation to build", () => {
    expect(() =>
      buildMultisigTransaction({
        source: new Account(master.publicKey(), "1"),
        operations: [],
        networkPassphrase: PASSPHRASE,
      }),
    ).toThrow(MultisigError);
  });
});
