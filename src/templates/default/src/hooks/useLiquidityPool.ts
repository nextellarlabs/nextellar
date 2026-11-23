'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  Horizon,
  TransactionBuilder,
  Operation,
  Networks,
  BASE_FEE,
  Transaction,
} from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';

export type LiquidityPoolRecord = Horizon.ServerApi.LiquidityPoolRecord;

export interface DepositLiquidityPoolParams {
  from: string;
  liquidityPoolId: string;
  maxAmountA: string;
  maxAmountB: string;
  minPrice: string;
  maxPrice: string;
}

export interface WithdrawLiquidityPoolParams {
  from: string;
  liquidityPoolId: string;
  amount: string;
  minAmountA: string;
  minAmountB: string;
}

export interface LiquidityPoolResult {
  success: boolean;
  txHash?: string;
  error?: string;
  raw?: unknown;
}

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_NETWORK = 'TESTNET';

/**
 * Hook to inspect, deposit, and withdraw from Stellar Liquidity Pools on Testnet / Public.
 */
export function useLiquidityPool(opts?: {
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

  const [pool, setPool] = useState<LiquidityPoolRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPoolById = useCallback(
    async (poolId: string): Promise<LiquidityPoolRecord | null> => {
      if (!poolId) return null;
      setLoading(true);
      setError(null);
      try {
        const result = await server.liquidityPools().liquidityPoolId(poolId).call();
        setPool(result);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch liquidity pool';
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [server]
  );

  const buildDepositXDR = useCallback(
    async ({
      from,
      liquidityPoolId,
      maxAmountA,
      maxAmountB,
      minPrice,
      maxPrice,
    }: DepositLiquidityPoolParams): Promise<string> => {
      const account = await server.loadAccount(from);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          Operation.liquidityPoolDeposit({
            liquidityPoolId,
            maxAmountA,
            maxAmountB,
            minPrice,
            maxPrice,
          })
        )
        .setTimeout(30)
        .build();

      return tx.toXDR();
    },
    [server, networkPassphrase]
  );

  const buildWithdrawXDR = useCallback(
    async ({
      from,
      liquidityPoolId,
      amount,
      minAmountA,
      minAmountB,
    }: WithdrawLiquidityPoolParams): Promise<string> => {
      const account = await server.loadAccount(from);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase,
      })
        .addOperation(
          Operation.liquidityPoolWithdraw({
            liquidityPoolId,
            amount,
            minAmountA,
            minAmountB,
          })
        )
        .setTimeout(30)
        .build();

      return tx.toXDR();
    },
    [server, networkPassphrase]
  );

  const submitSignedXDR = useCallback(
    async (signedXdr: string): Promise<LiquidityPoolResult> => {
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
    pool,
    loading,
    error,
    fetchPoolById,
    buildDepositXDR,
    buildWithdrawXDR,
    submitSignedXDR,
  };
}
