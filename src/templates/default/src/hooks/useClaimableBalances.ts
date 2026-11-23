'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  Horizon,
  TransactionBuilder,
  Operation,
  Networks,
  BASE_FEE,
  Asset,
  Claimant,
  Transaction,
} from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';

export type ClaimableRecord = Horizon.ServerApi.ClaimableBalanceRecord;

export interface CreateClaimableBalanceParams {
  from: string;
  asset?: Asset;
  amount: string;
  claimants: Claimant[];
}

export interface ClaimClaimableBalanceParams {
  from: string;
  balanceId: string;
}

export interface ClaimableBalanceResult {
  success: boolean;
  txHash?: string;
  error?: string;
  raw?: unknown;
}

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_NETWORK = 'TESTNET';

/**
 * Hook to inspect, create, and claim Stellar claimable balances on Testnet / Public.
 */
export function useClaimableBalances(opts?: {
  horizonUrl?: string;
  network?: 'TESTNET' | 'PUBLIC';
}) {
  const providerConfig = useWalletConfig();
  const {
    horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL,
    network = DEFAULT_NETWORK,
  } = opts || {};

  const server = useMemo(() => new Horizon.Server(horizonUrl), [horizonUrl]);
  const networkPassphrase = network === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;

  const [balances, setBalances] = useState<ClaimableRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchClaimableBalances = useCallback(
    async (claimantAddress: string): Promise<ClaimableRecord[]> => {
      if (!claimantAddress) {
        setBalances([]);
        return [];
      }
      setLoading(true);
      setError(null);
      try {
        const response = await server
          .claimableBalances()
          .claimant(claimantAddress)
          .limit(20)
          .call();
        setBalances(response.records);
        return response.records;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch claimable balances';
        setError(msg);
        return [];
      } finally {
        setLoading(false);
      }
    },
    [server]
  );

  const buildCreateClaimableBalanceXDR = useCallback(
    async ({
      from,
      asset = Asset.native(),
      amount,
      claimants,
    }: CreateClaimableBalanceParams): Promise<string> => {
      const account = await server.loadAccount(from);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          Operation.createClaimableBalance({
            asset,
            amount,
            claimants,
          })
        )
        .setTimeout(30)
        .build();

      return tx.toXDR();
    },
    [server, networkPassphrase]
  );

  const buildClaimClaimableBalanceXDR = useCallback(
    async ({ from, balanceId }: ClaimClaimableBalanceParams): Promise<string> => {
      const account = await server.loadAccount(from);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          Operation.claimClaimableBalance({
            balanceId,
          })
        )
        .setTimeout(30)
        .build();

      return tx.toXDR();
    },
    [server, networkPassphrase]
  );

  const submitSignedXDR = useCallback(
    async (signedXdr: string): Promise<ClaimableBalanceResult> => {
      try {
        const transaction = new Transaction(signedXdr, networkPassphrase);
        const result = await server.submitTransaction(transaction);
        return { success: true, txHash: result.hash, raw: result };
      } catch (err: unknown) {
        const errorObj = err as { message?: string };
        return {
          success: false,
          error: errorObj.message || 'Transaction submission failed',
        };
      }
    },
    [server, networkPassphrase]
  );

  return {
    balances,
    loading,
    error,
    fetchClaimableBalances,
    buildCreateClaimableBalanceXDR,
    buildClaimClaimableBalanceXDR,
    submitSignedXDR,
  };
}
