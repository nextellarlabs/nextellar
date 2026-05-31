import {
  Account,
  BASE_FEE,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  FeeBumpValidationError,
  loadFeeBumpSignerFromEnv,
  parseInnerTransaction,
  readMaxBumpFeeFromEnv,
  validateBumpFee,
} from "../routes/stellar.tx.feebump.js";

function buildSignedInner(): string {
  const user = Keypair.random();
  const tx = new TransactionBuilder(new Account(user.publicKey(), "1"), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: "fee-bump-test", value: "ok" }))
    .setTimeout(30)
    .build();

  tx.sign(user);
  return tx.toXDR();
}

describe("validateBumpFee", () => {
  it("returns the normalized fee when it is within the cap", () => {
    expect(validateBumpFee("500", "1000")).toBe("500");
  });

  it("rejects malformed fees", () => {
    expect(() => validateBumpFee("not-a-fee", "1000")).toThrow(FeeBumpValidationError);
    expect(() => validateBumpFee("0", "1000")).toThrow(/positive integer/);
  });

  it("rejects fees above the configured cap", () => {
    expect(() => validateBumpFee("1001", "1000")).toThrow(/exceeds configured maximum/);
  });
});

describe("parseInnerTransaction", () => {
  it("parses a signed inner transaction", () => {
    const tx = parseInnerTransaction(buildSignedInner(), Networks.TESTNET);
    expect(tx.signatures.length).toBe(1);
  });

  it("rejects malformed inner envelopes", () => {
    expect(() => parseInnerTransaction("definitely-not-xdr", Networks.TESTNET)).toThrow(/valid transaction envelope/);
  });

  it("rejects unsigned inner envelopes", () => {
    const user = Keypair.random();
    const tx = new TransactionBuilder(new Account(user.publicKey(), "1"), {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.manageData({ name: "fee-bump-test", value: "unsigned" }))
      .setTimeout(30)
      .build();

    expect(() => parseInnerTransaction(tx.toXDR(), Networks.TESTNET)).toThrow(/at least one user signature/);
  });

  it("rejects envelopes that are already fee-bump transactions", () => {
    const server = Keypair.random();
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      server.publicKey(),
      "100",
      parseInnerTransaction(buildSignedInner(), Networks.TESTNET),
      Networks.TESTNET,
    );

    expect(feeBump).toBeInstanceOf(FeeBumpTransaction);
    expect(() => parseInnerTransaction(feeBump.toXDR(), Networks.TESTNET)).toThrow(/must not already/);
  });
});

describe("fee-bump env helpers", () => {
  it("loads a signer from STELLAR_FEE_BUMP_SECRET", () => {
    const keypair = Keypair.random();
    const signer = loadFeeBumpSignerFromEnv({ STELLAR_FEE_BUMP_SECRET: keypair.secret() });

    expect(signer.publicKey).toBe(keypair.publicKey());
  });

  it("throws when the fee-bump secret is missing", () => {
    expect(() => loadFeeBumpSignerFromEnv({})).toThrow(/must be set/);
  });

  it("reads and validates the max fee cap from env", () => {
    expect(readMaxBumpFeeFromEnv({ STELLAR_FEE_BUMP_MAX_FEE: "12345" })).toBe("12345");
    expect(() => readMaxBumpFeeFromEnv({ STELLAR_FEE_BUMP_MAX_FEE: "bad" })).toThrow(/positive integer/);
  });
});

