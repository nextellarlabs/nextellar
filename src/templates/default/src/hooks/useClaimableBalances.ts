'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE_FEE, Horizon, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { useWallet, useWalletConfig } from '../contexts';

/** Horizon serializes claim predicates with snake_case keys. */
export type ClaimPredicate =
  | { unconditional: boolean }
  | { abs_before: string }
  | { rel_before: string }
  | { and: ClaimPredicate[] }
  | { or: ClaimPredicate[] }
  | { not: ClaimPredicate };

export interface ClaimableBalance {
  id: string;
  asset: string;
  amount: string;
  claimants: { destination: string; predicate: ClaimPredicate }[];
  /** Horizon's close time for the ledger that created the balance. */
  last_modified_time?: string;
  last_modified_ledger?: number;
  created_at?: string;
}

/** Unknown or malformed predicates fail closed, including inside `not`. */
function predicateResult(predicate: ClaimPredicate, createdAt: string | undefined, now: number): boolean | null {
  if (!predicate || typeof predicate !== 'object') return null;
  if ('unconditional' in predicate) return predicate.unconditional === true;
  if ('abs_before' in predicate) {
    const value = predicate.abs_before;
    const deadline = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value);
    return Number.isFinite(deadline) ? now < deadline : null;
  }
  if ('rel_before' in predicate) {
    const seconds = Number(predicate.rel_before);
    const created = createdAt ? Date.parse(createdAt) : NaN;
    return Number.isFinite(seconds) && seconds >= 0 && Number.isFinite(created)
      ? now < created + seconds * 1000
      : null;
  }
  if ('and' in predicate && Array.isArray(predicate.and) && predicate.and.length > 0) {
    const values = predicate.and.map((part) => predicateResult(part, createdAt, now));
    return values.includes(false) ? false : values.includes(null) ? null : true;
  }
  if ('or' in predicate && Array.isArray(predicate.or) && predicate.or.length > 0) {
    const values = predicate.or.map((part) => predicateResult(part, createdAt, now));
    return values.includes(true) ? true : values.includes(null) ? null : false;
  }
  if ('not' in predicate && predicate.not) {
    const result = predicateResult(predicate.not, createdAt, now);
    return result === null ? null : !result;
  }
  return null;
}

export function canClaimBalance(balance: ClaimableBalance, publicKey: string, now = Date.now()): boolean {
  const claimant = balance.claimants.find(({ destination }) => destination === publicKey);
  return claimant ? predicateResult(claimant.predicate, balance.created_at ?? balance.last_modified_time, now) === true : false;
}

function needsCreationTime(predicate: ClaimPredicate): boolean {
  if ('rel_before' in predicate) return true;
  if ('and' in predicate) return predicate.and.some(needsCreationTime);
  if ('or' in predicate) return predicate.or.some(needsCreationTime);
  if ('not' in predicate) return needsCreationTime(predicate.not);
  return false;
}

export function useClaimableBalances(publicKey?: string | null, horizonUrl?: string) {
  const wallet = useWallet();
  const config = useWalletConfig();
  const url = horizonUrl ?? config?.horizonUrl ?? 'https://horizon-testnet.stellar.org';
  const networkPassphrase = config?.network ?? Networks.TESTNET;
  const [balances, setBalances] = useState<ClaimableBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<Error | null>(null);
  const [claimedId, setClaimedId] = useState<string | null>(null);
  const requestId = useRef(0);
  const claimInFlight = useRef(false);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    if (!publicKey) {
      setBalances([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const server = new Horizon.Server(url);
      let page = await server.claimableBalances().claimant(publicKey).limit(200).call();
      const records: ClaimableBalance[] = [];
      while (page.records.length > 0) {
        records.push(...(page.records as unknown as ClaimableBalance[]));
        if (page.records.length < 200) break;
        page = await page.next();
      }
      // Horizon exposes the creation ledger, but not its close time, on a
      // claimable balance. Resolve that ledger only for relative predicates.
      const ledgerTimes = new Map<number, Promise<string | undefined>>();
      const resolved = await Promise.all(records.map(async (record) => {
        const claimant = record.claimants.find(({ destination }) => destination === publicKey);
        const ledger = record.last_modified_ledger;
        if (!claimant || !needsCreationTime(claimant.predicate) || !ledger) return record;
        if (!ledgerTimes.has(ledger)) {
          ledgerTimes.set(ledger, server.ledgers().ledger(ledger).call()
            .then((result) => (result as unknown as { closed_at: string }).closed_at)
            .catch(() => undefined));
        }
        return { ...record, created_at: await ledgerTimes.get(ledger) };
      }));
      if (id === requestId.current) setBalances(resolved);
    } catch (cause) {
      if (id === requestId.current) setError(cause instanceof Error ? cause : new Error('Failed to load claimable balances'));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [publicKey, url]);

  useEffect(() => {
    setBalances([]);
    setClaimError(null);
    setClaimedId(null);
    void refresh();
    return () => { requestId.current++; };
  }, [refresh]);

  const claim = useCallback(async (balanceId: string) => {
    if (claimInFlight.current) return;
    const balance = balances.find(({ id }) => id === balanceId);
    if (!publicKey || !wallet.connected || wallet.publicKey !== publicKey || wallet.networkMismatch ||
      !balance || !canClaimBalance(balance, publicKey)) {
      throw new Error('This balance cannot be claimed by the connected wallet yet');
    }
    claimInFlight.current = true;
    setClaimingId(balanceId);
    setClaimError(null);
    setClaimedId(null);
    try {
      const server = new Horizon.Server(url);
      const account = await server.loadAccount(publicKey);
      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase,
      }).addOperation(Operation.claimClaimableBalance({ balanceId })).setTimeout(30).build();
      const { signTransaction } = await import('../lib/stellar-wallet-kit');
      const signedXdr = await signTransaction({ unsignedTransaction: transaction.toXDR(), address: publicKey });
      await server.submitTransaction(TransactionBuilder.fromXDR(signedXdr, networkPassphrase));
      setBalances((current) => current.filter(({ id }) => id !== balanceId));
      setClaimedId(balanceId);
      await refresh();
      try {
        await wallet.refreshBalances();
      } catch {
        // The claim is already confirmed; a balance refresh must not turn it
        // into a reported claim failure.
      }
    } catch (cause) {
      const claimFailure = cause instanceof Error ? cause : new Error('Failed to claim balance');
      setClaimError(claimFailure);
      throw claimFailure;
    } finally {
      claimInFlight.current = false;
      setClaimingId(null);
    }
  }, [balances, networkPassphrase, publicKey, refresh, url, wallet]);

  return { balances, loading, error, refresh, claim, claimingId, claimError, claimedId };
}
