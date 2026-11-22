'use client';
import { useCallback, useRef, useState } from 'react';
import { createMultisigSession } from '../lib/multisig';

/**
 * React wrapper around `createMultisigSession` (lib/multisig.js).
 *
 * @param {object|null|undefined} account - Horizon account record (`thresholds` + `signers`) of the
 *   transaction source, e.g. from `server.loadAccount(id)`.
 * @param {string} networkPassphrase
 *
 * @example
 * ```jsx
 * const multisig = useMultisigTransaction(accountRecord, Networks.TESTNET);
 * multisig.load(unsignedXdr);
 * multisig.addSignedXdr(await walletSign(unsignedXdr));
 * if (multisig.thresholdMet) submit(multisig.xdr);
 * ```
 */
export function useMultisigTransaction(account, networkPassphrase) {
    const sessionRef = useRef(null);
    const [status, setStatus] = useState(null);
    const [xdr, setXdr] = useState(null);
    const [error, setError] = useState(null);

    const run = useCallback((action) => {
        const session = sessionRef.current;
        if (!session) {
            setError(new Error('No transaction loaded. Call load() first.'));
            return null;
        }
        try {
            const next = action(session);
            setStatus(next);
            setXdr(session.toXDR());
            setError(null);
            return next;
        }
        catch (err) {
            setError(err instanceof Error ? err : new Error(String(err)));
            return null;
        }
    }, []);

    const load = useCallback((transaction, options = {}) => {
        if (!account) {
            setError(new Error('Account signers/thresholds are required to track a multi-sig transaction.'));
            return null;
        }
        try {
            sessionRef.current = createMultisigSession({
                transaction,
                networkPassphrase,
                account,
                thresholdLevel: options.thresholdLevel,
            });
        }
        catch (err) {
            sessionRef.current = null;
            setStatus(null);
            setXdr(null);
            setError(err instanceof Error ? err : new Error(String(err)));
            return null;
        }
        return run((session) => session.status());
    }, [account, networkPassphrase, run]);

    const addSignedXdr = useCallback((signed) => run((s) => s.addSignedXdr(signed)), [run]);
    const addSignature = useCallback(
        (publicKey, signature) => run((s) => s.addSignature(publicKey, signature)),
        [run],
    );
    const signWith = useCallback((keypair) => run((s) => s.signWith(keypair)), [run]);

    const reset = useCallback(() => {
        sessionRef.current = null;
        setStatus(null);
        setXdr(null);
        setError(null);
    }, []);

    return {
        load,
        addSignedXdr,
        addSignature,
        signWith,
        reset,
        status,
        xdr,
        thresholdMet: status?.thresholdMet ?? false,
        error,
    };
}
