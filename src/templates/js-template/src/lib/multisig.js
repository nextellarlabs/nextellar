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
    FeeBumpTransaction,
    Keypair,
    StrKey,
    TransactionBuilder,
    hash,
} from '@stellar/stellar-sdk';

// ── Thresholds ─────────────────────────────────────────────────────────────────

const LOW_THRESHOLD_OPS = new Set(['allowTrust', 'bumpSequence', 'setTrustLineFlags']);

const LEVEL_RANK = { low: 0, medium: 1, high: 2 };

/**
 * Threshold level a single operation requires, per Stellar's operation list.
 * @param {{type: string, [key: string]: unknown}} op
 * @returns {'low'|'medium'|'high'}
 */
export function thresholdLevelForOperation(op) {
    if (op.type === 'accountMerge') return 'high';
    if (op.type === 'setOptions') {
        const changesAuth = ['signer', 'masterWeight', 'lowThreshold', 'medThreshold', 'highThreshold'].some(
            (field) => op[field] !== undefined,
        );
        return changesAuth ? 'high' : 'medium';
    }
    if (LOW_THRESHOLD_OPS.has(op.type)) return 'low';
    return 'medium';
}

/**
 * Highest threshold level required by any operation in the transaction.
 * @param {import('@stellar/stellar-sdk').Transaction | import('@stellar/stellar-sdk').FeeBumpTransaction} tx
 * @returns {'low'|'medium'|'high'}
 */
export function thresholdLevelForTransaction(tx) {
    const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
    return inner.operations.reduce((level, op) => {
        const next = thresholdLevelForOperation(op);
        return LEVEL_RANK[next] > LEVEL_RANK[level] ? next : level;
    }, 'low');
}

/**
 * @param {{thresholds: {low_threshold: number, med_threshold: number, high_threshold: number}}} account
 * @param {'low'|'medium'|'high'} level
 * @returns {number}
 */
export function requiredWeightFor(account, level) {
    const { low_threshold, med_threshold, high_threshold } = account.thresholds;
    const threshold = level === 'high' ? high_threshold : level === 'medium' ? med_threshold : low_threshold;
    return Math.max(Number(threshold) || 0, 1);
}

// ── Signature evaluation ───────────────────────────────────────────────────────

function sameBytes(a, b) {
    return Buffer.from(a).equals(Buffer.from(b));
}

/**
 * Evaluate which of `account`'s signers have validly signed `tx`.
 *
 * @param {import('@stellar/stellar-sdk').Transaction | import('@stellar/stellar-sdk').FeeBumpTransaction} tx
 * @param {{id: string, thresholds: object, signers: Array<{key: string, weight: number, type: string}>}} account
 * @param {'low'|'medium'|'high'} [level]
 */
export function evaluateSignatures(tx, account, level = thresholdLevelForTransaction(tx)) {
    const txHash = tx.hash();
    const signatures = tx.signatures;
    const matched = new Set();

    const signers = account.signers.map((signer) => {
        let signed = false;
        let supported = true;

        try {
            if (signer.type === 'ed25519_public_key') {
                const kp = Keypair.fromPublicKey(signer.key);
                const hint = kp.signatureHint();
                signatures.forEach((sig, i) => {
                    if (!signed && sameBytes(sig.hint(), hint) && kp.verify(txHash, sig.signature())) {
                        signed = true;
                        matched.add(i);
                    }
                });
            }
            else if (signer.type === 'preauth_tx') {
                signed = sameBytes(StrKey.decodePreAuthTx(signer.key), txHash);
            }
            else if (signer.type === 'sha256_hash') {
                const expected = StrKey.decodeSha256Hash(signer.key);
                const hint = expected.subarray(expected.length - 4);
                signatures.forEach((sig, i) => {
                    if (!signed && sameBytes(sig.hint(), hint) && sameBytes(hash(sig.signature()), expected)) {
                        signed = true;
                        matched.add(i);
                    }
                });
            }
            else {
                supported = false;
            }
        }
        catch {
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

/**
 * @param {{source: import('@stellar/stellar-sdk').Account, operations: Array, networkPassphrase: string, fee?: string, timeoutSeconds?: number, memo?: import('@stellar/stellar-sdk').Memo}} params
 * @returns {import('@stellar/stellar-sdk').Transaction}
 */
export function buildMultisigTransaction(params) {
    const { source, operations, networkPassphrase, fee = '100', timeoutSeconds = 3600, memo } = params;
    if (!operations.length) {
        throw new MultisigError('buildMultisigTransaction: at least one operation is required.');
    }
    const builder = new TransactionBuilder(source, { fee, networkPassphrase });
    operations.forEach((op) => builder.addOperation(op));
    if (memo) builder.addMemo(memo);
    return builder.setTimeout(timeoutSeconds).build();
}

export class MultisigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MultisigError';
    }
}

// ── Session ────────────────────────────────────────────────────────────────────

function parse(txOrXdr, networkPassphrase) {
    if (typeof txOrXdr !== 'string') return txOrXdr;
    try {
        return TransactionBuilder.fromXDR(txOrXdr, networkPassphrase);
    }
    catch (err) {
        throw new MultisigError(`Invalid transaction XDR: ${err.message}`);
    }
}

function signatureKey(sig) {
    return `${Buffer.from(sig.hint()).toString('hex')}:${Buffer.from(sig.signature()).toString('hex')}`;
}

/**
 * Track signature collection for one transaction.
 *
 * @param {{transaction: string|object, networkPassphrase: string, account: object, thresholdLevel?: 'low'|'medium'|'high'}} params
 *
 * @example
 * const session = createMultisigSession({ transaction: xdr, networkPassphrase, account });
 * session.addSignedXdr(signedByAlice);
 * session.addSignedXdr(signedByBob);
 * if (session.status().thresholdMet) await server.submitTransaction(session.transaction);
 */
export function createMultisigSession(params) {
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
                throw new MultisigError('Signed XDR is for a different transaction (hash mismatch).');
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
            }
            catch (err) {
                throw new MultisigError(`Invalid signature for ${publicKey}: ${err.message}`);
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
