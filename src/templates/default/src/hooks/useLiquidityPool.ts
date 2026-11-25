'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Operation,
  Networks,
  Asset,
  LiquidityPoolAsset,
  BASE_FEE,
  Transaction,
} from '@stellar/stellar-sdk';
import { useWalletConfig } from '../contexts';
import { decodeResultCodes } from '../lib/stellarResultCodes';

export interface LiquidityPoolDepositParams {
  from: string;
  liquidityPoolId: string;
  maxAmountA: string;
  maxAmountB: string;
  minPrice: string | number;
  maxPrice: string | number;
  assetA?: Asset;
  assetB?: Asset;
  feeBps?: number;
}

export interface LiquidityPoolWithdrawParams {
  from: string;
  liquidityPoolId: string;
  amount: string;
  minAmountA: string;
  minAmountB: string;
}

export interface LiquidityPoolResult {
  success: boolean;
  txHash?: string;
  raw?: unknown;
  error?: string;
  resultCodes?: { transaction?: string; operations?: string[] };
}

export interface UseLiquidityPoolOptions {
  horizonUrl?: string;
  network?: 'TESTNET' | 'PUBLIC';
}

const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
const DEFAULT_NETWORK = 'TESTNET';
const DEFAULT_FEE_BPS = 30; // 0.3%

/**
 * Custom React hook for managing AMM Liquidity Pool deposits and withdrawals.
 *
 * Implements:
 * - Deposit with min/max price bounds
 * - Withdraw with minimum received amount protection
 * - Automatic pool-share trustline check and establishment
 * - Loading and error states matching sibling hooks
 */
export function useLiquidityPool(options: UseLiquidityPoolOptions = {}) {
  const providerConfig = useWalletConfig();
  const {
    horizonUrl = providerConfig?.horizonUrl ?? DEFAULT_HORIZON_URL,
    network = DEFAULT_NETWORK,
  } = options;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const server = useMemo(() => new Horizon.Server(horizonUrl), [horizonUrl]);
  const networkPassphrase = network === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;

  /**
   * Checks if an account already has a trustline for the given liquidity pool.
   */
  const checkPoolShareTrustline = useCallback(
    async (accountPublicKey: string, poolId: string): Promise<boolean> => {
      try {
        const account = await server.loadAccount(accountPublicKey);
        return account.balances.some(
          (b: any) =>
            b.asset_type === 'liquidity_pool_shares' &&
            b.liquidity_pool_id === poolId,
        );
      } catch (err: any) {
        if (err?.response?.status === 404) {
          throw new Error(`Account ${accountPublicKey} not found.`);
        }
        throw err;
      }
    },
    [server],
  );

  /**
   * Builds an unsigned transaction XDR for depositing into a liquidity pool.
   * If the account lacks the pool-share trustline and assetA/assetB are provided,
   * a changeTrust operation is automatically prepended.
   */
  const buildDepositXDR = useCallback(
    async (params: LiquidityPoolDepositParams): Promise<string> => {
      const {
        from,
        liquidityPoolId,
        maxAmountA,
        maxAmountB,
        minPrice,
        maxPrice,
        assetA,
        assetB,
        feeBps = DEFAULT_FEE_BPS,
      } = params;

      if (!from) throw new Error('From public key is required');
      if (!liquidityPoolId) throw new Error('Liquidity pool ID is required');
      if (!maxAmountA || Number(maxAmountA) <= 0) {
        throw new Error('maxAmountA must be a positive number');
      }
      if (!maxAmountB || Number(maxAmountB) <= 0) {
        throw new Error('maxAmountB must be a positive number');
      }
      if (Number(minPrice) > Number(maxPrice)) {
        throw new Error('minPrice cannot be greater than maxPrice');
      }

      const account = await server.loadAccount(from);
      const hasTrustline = account.balances.some(
        (b: any) =>
          b.asset_type === 'liquidity_pool_shares' &&
          b.liquidity_pool_id === liquidityPoolId,
      );

      const builder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase,
      });

      // Prepend pool share changeTrust if missing and assets are provided
      if (!hasTrustline) {
        if (!assetA || !assetB) {
          throw new Error(
            'Account is missing pool-share trustline; assetA and assetB are required to establish it.',
          );
        }
        const poolAsset = new LiquidityPoolAsset(assetA, assetB, feeBps);
        builder.addOperation(
          Operation.changeTrust({
            asset: poolAsset,
          }),
        );
      }

      builder.addOperation(
        Operation.liquidityPoolDeposit({
          liquidityPoolId,
          maxAmountA,
          maxAmountB,
          minPrice,
          maxPrice,
        }),
      );

      builder.setTimeout(30);
      const transaction = builder.build();
      return transaction.toXDR();
    },
    [server, networkPassphrase],
  );

  /**
   * Builds an unsigned transaction XDR for withdrawing from a liquidity pool.
   */
  const buildWithdrawXDR = useCallback(
    async (params: LiquidityPoolWithdrawParams): Promise<string> => {
      const { from, liquidityPoolId, amount, minAmountA, minAmountB } = params;

      if (!from) throw new Error('From public key is required');
      if (!liquidityPoolId) throw new Error('Liquidity pool ID is required');
      if (!amount || Number(amount) <= 0) {
        throw new Error('Amount must be a positive number');
      }

      const account = await server.loadAccount(from);

      const builder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase,
      });

      builder.addOperation(
        Operation.liquidityPoolWithdraw({
          liquidityPoolId,
          amount,
          minAmountA,
          minAmountB,
        }),
      );

      builder.setTimeout(30);
      const transaction = builder.build();
      return transaction.toXDR();
    },
    [server, networkPassphrase],
  );

  /**
   * Submits a signed transaction XDR to Horizon.
   */
  const submitSignedXDR = useCallback(
    async (signedXdr: string): Promise<LiquidityPoolResult> => {
      if (!signedXdr || typeof signedXdr !== 'string') {
        return { success: false, error: 'Invalid XDR' };
      }

      setLoading(true);
      setError(null);

      try {
        const tx = new Transaction(signedXdr, networkPassphrase);
        const res = await server.submitTransaction(tx);
        return { success: true, txHash: res.hash, raw: res };
      } catch (err: any) {
        const codes = err?.response?.data?.extras?.result_codes;
        let errorMessage = err?.message || 'Transaction submission failed';
        if (codes) {
          errorMessage = decodeResultCodes(codes).reason;
        }
        const errObj = new Error(errorMessage);
        setError(errObj);
        return {
          success: false,
          error: errorMessage,
          raw: err?.response?.data,
          resultCodes: codes,
        };
      } finally {
        setLoading(false);
      }
    },
    [server, networkPassphrase],
  );

  /**
   * Helper to build, sign and submit deposit with a secret key (dev only).
   */
  const depositWithSecret = useCallback(
    async (
      params: LiquidityPoolDepositParams & { secret: string },
    ): Promise<LiquidityPoolResult> => {
      try {
        const kp = Keypair.fromSecret(params.secret);
        const unsignedXdr = await buildDepositXDR(params);
        const tx = new Transaction(unsignedXdr, networkPassphrase);
        tx.sign(kp);
        return await submitSignedXDR(tx.toXDR());
      } catch (err: any) {
        const errObj = err instanceof Error ? err : new Error(err?.message || 'Deposit failed');
        setError(errObj);
        return { success: false, error: errObj.message };
      }
    },
    [buildDepositXDR, submitSignedXDR, networkPassphrase],
  );

  /**
   * Helper to build, sign and submit withdraw with a secret key (dev only).
   */
  const withdrawWithSecret = useCallback(
    async (
      params: LiquidityPoolWithdrawParams & { secret: string },
    ): Promise<LiquidityPoolResult> => {
      try {
        const kp = Keypair.fromSecret(params.secret);
        const unsignedXdr = await buildWithdrawXDR(params);
        const tx = new Transaction(unsignedXdr, networkPassphrase);
        tx.sign(kp);
        return await submitSignedXDR(tx.toXDR());
      } catch (err: any) {
        const errObj = err instanceof Error ? err : new Error(err?.message || 'Withdrawal failed');
        setError(errObj);
        return { success: false, error: errObj.message };
      }
    },
    [buildWithdrawXDR, submitSignedXDR, networkPassphrase],
  );

  return {
    loading,
    error,
    checkPoolShareTrustline,
    buildDepositXDR,
    buildWithdrawXDR,
    submitSignedXDR,
    depositWithSecret,
    withdrawWithSecret,
  };
}

export default useLiquidityPool;
