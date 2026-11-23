/**
 * Multi-signature transaction helpers.
 *
 * Builds a transaction, collects signatures from several signers (each signing
 * the same XDR on their own device), and tells you which of the account's
 * signers have signed and whether the account's threshold is met. Works for
 * classic and Soroban transactions: both are signed over the same transaction
 * hash. Soroban *auth entries* are separate and are not covered here.
 *
 * Signer types counted toward the threshold:
 *   - ed25519_public_key — a signature whose hint matches and that verifies
 *     against the transaction hash
 *   - preauth_tx         — when the pre-authorized hash equals this transaction's hash
 *   - sha256_hash        — when a "signature" is the preimage of the signer's hash
 * ed25519_signed_payload signers are reported but not counted.
 *
 * Thresholds follow Stellar's rules: each operation needs the low, medium or
 * high threshold of its source account, and a transaction needs the highest
 * of those. A threshold of 0 still needs at least one valid signature, so the
 * effective required weight is max(threshold, 1).
 *
 * Limitation: only the transaction source account's signers are evaluated.
 * Operations with a different `source` account need that account's signers too.
 */

import {
  Account,
  FeeBumpTransaction,
  Keypair,
  Memo,
  StrKey,
  Transaction,
  TransactionBuilder,
  hash,
  xdr,
} from "@stellar/stellar-sdk";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ThresholdLevel = "low" | "medium" | "high";

/** Signer as returned by Horizon's /accounts/{id} `signers` array. */
export interface MultisigSigner {
  key: string;
  weight: number;
  type: string;
}

/** The subset of a Horizon account record needed to evaluate signatures. */
export interface MultisigAccount {
  id: string;
  thresholds: {
    low_threshold: number;
    med_threshold: number;
    high_threshold: number;
  };
  signers: MultisigSigner[];
}

export interface SignerStatus extends MultisigSigner {
  signed: boolean;
  /** False for signer types this helper cannot verify (ed25519_signed_payload). */
  supported: boolean;
}

export interface MultisigStatus {
  thresholdLevel: ThresholdLevel;
  /** Weight the account needs for this transaction: max(threshold, 1). */
  requiredWeight: number;
  /** Sum of the weights of signers whose signature is present and valid. */
  signedWeight: number;
  thresholdMet: boolean;
  signers: SignerStatus[];
  /** Supported signers with weight > 0 that have not signed yet. */
  pendingSigners: SignerStatus[];
  /** Signatures on the envelope that match no signer. Stellar rejects these with tx_bad_auth_extra. */
  unknownSignatures: number;
}

export class MultisigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultisigError";
  }
}

type AnyTransaction = Transaction | FeeBumpTransaction;

// ── Thresholds ─────────────────────────────────────────────────────────────────

const LOW_THRESHOLD_OPS = new Set(["allowTrust", "bumpSequence", "setTrustLineFlags"]);

const LEVEL_RANK: Record<ThresholdLevel, number> = { low: 0, medium: 1, high: 2 };

/** Threshold level a single operation requires, per Stellar's operation list. */
export function thresholdLevelForOperation(op: { type: string; [key: string]: unknown }): ThresholdLevel {
  if (op.type === "accountMerge") return "high";
  if (op.type === "setOptions") {
    const changesAuth = ["signer", "masterWeight", "lowThreshold", "medThreshold", "highThreshold"].some(
      (field) => op[field] !== undefined,
    );
    return changesAuth ? "high" : "medium";
  }
  if (LOW_THRESHOLD_OPS.has(op.type)) return "low";
  return "medium";
}

/** Highest threshold level required by any operation in the transaction. */
export function thresholdLevelForTransaction(tx: AnyTransaction): ThresholdLevel {
  const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
  return inner.operations.reduce<ThresholdLevel>((level, op) => {
    const next = thresholdLevelForOperation(op as unknown as { type: string });
    return LEVEL_RANK[next] > LEVEL_RANK[level] ? next : level;
  }, "low");
}

export function requiredWeightFor(account: MultisigAccount, level: ThresholdLevel): number {
  const { low_threshold, med_threshold, high_threshold } = account.thresholds;
  const threshold = level === "high" ? high_threshold : level === "medium" ? med_threshold : low_threshold;
  return Math.max(Number(threshold) || 0, 1);
}

// ── Signature evaluation ───────────────────────────────────────────────────────

function sameBytes(a: Buffer | Uint8Array, b: Buffer | Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}

/**
 * Evaluate which of `account`'s signers have validly signed `tx`.
 */
export function evaluateSignatures(
  tx: AnyTransaction,
  account: MultisigAccount,
  level: ThresholdLevel = thresholdLevelForTransaction(tx),
): MultisigStatus {
  const txHash = tx.hash();
  const signatures = tx.signatures;
  const matched = new Set<number>();

  const signers: SignerStatus[] = account.signers.map((signer) => {
    let signed = false;
    let supported = true;

    try {
      if (signer.type === "ed25519_public_key") {
        const kp = Keypair.fromPublicKey(signer.key);
        const hint = kp.signatureHint();
        signatures.forEach((sig, i) => {
          if (!signed && sameBytes(sig.hint(), hint) && kp.verify(txHash, sig.signature())) {
            signed = true;
            matched.add(i);
          }
        });
      } else if (signer.type === "preauth_tx") {
        signed = sameBytes(StrKey.decodePreAuthTx(signer.key), txHash);
      } else if (signer.type === "sha256_hash") {
        const expected = StrKey.decodeSha256Hash(signer.key);
        const hint = expected.subarray(expected.length - 4);
        signatures.forEach((sig, i) => {
          if (!signed && sameBytes(sig.hint(), hint) && sameBytes(hash(sig.signature()), expected)) {
            signed = true;
            matched.add(i);
          }
        });
      } else {
        supported = false;
      }
    } catch {
      // A malformed signer key cannot have signed.
      signed = false;
    }

    return { ...signer, signed, supported };
  });

  const requiredWeight = requiredWeightFor(account, level);
  const signedWeight = signers.filter((s) => s.signed).reduce((sum, s) => sum + s.weight, 0);

  return {
    thresholdLevel: level,
    requiredWeight,
    signedWeight,
    thresholdMet: signedWeight >= requiredWeight,
    signers,
    pendingSigners: signers.filter((s) => s.supported && !s.signed && s.weight > 0),
    unknownSignatures: signatures.length - matched.size,
  };
}

// ── Building ───────────────────────────────────────────────────────────────────

export interface BuildMultisigTransactionParams {
  source: Account;
  operations: xdr.Operation[];
  networkPassphrase: string;
  /** Base fee per operation in stroops. Default "100". */
  fee?: string;
  /** Seconds until the transaction expires. Default 3600, which leaves time to collect signatures. */
  timeoutSeconds?: number;
  memo?: Memo;
}

export function buildMultisigTransaction(params: BuildMultisigTransactionParams): Transaction {
  const { source, operations, networkPassphrase, fee = "100", timeoutSeconds = 3600, memo } = params;
  if (!operations.length) throw new MultisigError("buildMultisigTransaction: at least one operation is required.");
  const builder = new TransactionBuilder(source, { fee, networkPassphrase });
  operations.forEach((op) => builder.addOperation(op));
  if (memo) builder.addMemo(memo);
  return builder.setTimeout(timeoutSeconds).build();
}

// ── Session ────────────────────────────────────────────────────────────────────

export interface MultisigSessionParams {
  /** Unsigned (or partially signed) transaction, as XDR or an SDK object. */
  transaction: string | AnyTransaction;
  networkPassphrase: string;
  account: MultisigAccount;
  /** Override the threshold level derived from the operations. */
  thresholdLevel?: ThresholdLevel;
}

export interface MultisigSession {
  readonly transaction: AnyTransaction;
  /** Merge signatures from a copy of the same transaction signed elsewhere. */
  addSignedXdr(signedXdr: string): MultisigStatus;
  /** Add a raw base64 signature from `publicKey` (verified by the SDK). */
  addSignature(publicKey: string, signatureBase64: string): MultisigStatus;
  /** Sign locally with a keypair (e.g. in tests or server-side co-signing). */
  signWith(keypair: Keypair): MultisigStatus;
  status(): MultisigStatus;
  toXDR(): string;
}

function parse(txOrXdr: string | AnyTransaction, networkPassphrase: string): AnyTransaction {
  if (typeof txOrXdr !== "string") return txOrXdr;
  try {
    return TransactionBuilder.fromXDR(txOrXdr, networkPassphrase);
  } catch (err) {
    throw new MultisigError(`Invalid transaction XDR: ${(err as Error).message}`);
  }
}

function signatureKey(sig: xdr.DecoratedSignature): string {
  return `${Buffer.from(sig.hint()).toString("hex")}:${Buffer.from(sig.signature()).toString("hex")}`;
}

/**
 * Track signature collection for one transaction.
 *
 * @example
 * const session = createMultisigSession({ transaction: xdr, networkPassphrase, account });
 * session.addSignedXdr(signedByAlice);
 * session.addSignedXdr(signedByBob);
 * if (session.status().thresholdMet) await server.submitTransaction(session.transaction);
 */
export function createMultisigSession(params: MultisigSessionParams): MultisigSession {
  const { networkPassphrase, account } = params;
  const tx = parse(params.transaction, networkPassphrase);
  const level = params.thresholdLevel ?? thresholdLevelForTransaction(tx);
  const txHash = tx.hash();

  const status = () => evaluateSignatures(tx, account, level);

  return {
    transaction: tx,
    addSignedXdr(signedXdr) {
      const signed = parse(signedXdr, networkPassphrase);
      if (!sameBytes(signed.hash(), txHash)) {
        throw new MultisigError("Signed XDR is for a different transaction (hash mismatch).");
      }
      const existing = new Set(tx.signatures.map(signatureKey));
      for (const sig of signed.signatures) {
        const key = signatureKey(sig);
        if (!existing.has(key)) {
          tx.signatures.push(sig);
          existing.add(key);
        }
      }
      return status();
    },
    addSignature(publicKey, signatureBase64) {
      try {
        tx.addSignature(publicKey, signatureBase64);
      } catch (err) {
        throw new MultisigError(`Invalid signature for ${publicKey}: ${(err as Error).message}`);
      }
      return status();
    },
    signWith(keypair) {
      tx.sign(keypair);
      return status();
    },
    status,
    toXDR: () => tx.toXDR(),
  };
}
