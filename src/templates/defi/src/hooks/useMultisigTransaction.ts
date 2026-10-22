'use client';

import { useCallback, useRef, useState } from 'react';
import type { FeeBumpTransaction, Keypair, Transaction } from '@stellar/stellar-sdk';
import {
  createMultisigSession,
  type MultisigAccount,
  type MultisigSession,
  type MultisigStatus,
  type ThresholdLevel,
} from '../lib/multisig';

export interface UseMultisigTransactionReturn {
  /** Start tracking a transaction (XDR or SDK object). Replaces any previous one. */
  load: (
    transaction: string | Transaction | FeeBumpTransaction,
    options?: { thresholdLevel?: ThresholdLevel },
  ) => MultisigStatus | null;
  /** Merge a co-signer's signed copy of the same transaction. */
  addSignedXdr: (signedXdr: string) => MultisigStatus | null;
  /** Add a raw base64 signature from a known signer. */
  addSignature: (publicKey: string, signatureBase64: string) => MultisigStatus | null;
  /** Sign with a local keypair. */
  signWith: (keypair: Keypair) => MultisigStatus | null;
  reset: () => void;
  status: MultisigStatus | null;
  /** Current envelope XDR including every collected signature. */
  xdr: string | null;
  thresholdMet: boolean;
  error: Error | null;
}

/**
 * React wrapper around `createMultisigSession` (lib/multisig.ts).
 *
 * @param account Horizon account record (`thresholds` + `signers`) of the
 *   transaction source, e.g. from `server.loadAccount(id)`.
 *
 * @example
 * const multisig = useMultisigTransaction(accountRecord, Networks.TESTNET);
 * multisig.load(unsignedXdr);
 * multisig.addSignedXdr(await walletSign(unsignedXdr));
 * if (multisig.thresholdMet) submit(multisig.xdr);
 */
export function useMultisigTransaction(
  account: MultisigAccount | null | undefined,
  networkPassphrase: string,
): UseMultisigTransactionReturn {
  const sessionRef = useRef<MultisigSession | null>(null);
  const [status, setStatus] = useState<MultisigStatus | null>(null);
  const [xdr, setXdr] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback((action: (session: MultisigSession) => MultisigStatus): MultisigStatus | null => {
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
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return null;
    }
  }, []);

  const load = useCallback<UseMultisigTransactionReturn['load']>(
    (transaction, options = {}) => {
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
      } catch (err) {
        sessionRef.current = null;
        setStatus(null);
        setXdr(null);
        setError(err instanceof Error ? err : new Error(String(err)));
        return null;
      }
      return run((session) => session.status());
    },
    [account, networkPassphrase, run],
  );

  const addSignedXdr = useCallback((signed: string) => run((s) => s.addSignedXdr(signed)), [run]);
  const addSignature = useCallback(
    (publicKey: string, signature: string) => run((s) => s.addSignature(publicKey, signature)),
    [run],
  );
  const signWith = useCallback((keypair: Keypair) => run((s) => s.signWith(keypair)), [run]);

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
