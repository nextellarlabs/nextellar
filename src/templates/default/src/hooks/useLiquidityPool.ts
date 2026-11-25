import { useState, useEffect, useCallback, useRef } from 'react';
import { useWalletConfig } from '../contexts';

export interface PoolReserve {
  /** Raw Horizon asset string ("native" or "CODE:ISSUER"). */
  asset: string;
  /** Human-readable asset code ("XLM" for native). */
  code: string;
  /** Asset issuer public key (undefined for native XLM). */
  issuer?: string;
  /** Reserve amount as a decimal string. */
  amount: string;
}

export interface LiquidityPoolData {
  id: string;
  feeBp: number;
  type: string;
  totalTrustlines: string;
  totalShares: string;
  reserves: PoolReserve[];
}

export interface DepositParams {
  maxAmountA: string;
  maxAmountB: string;
  minPrice?: string;
  maxPrice?: string;
}

export interface WithdrawParams {
  amount: string;
  minAmountA?: string;
  minAmountB?: string;
}

export interface UseLiquidityPoolOptions {
  /** Account public key to query user's pool share balance. */
  publicKey?: string | null;
  /** Overrides the Horizon endpoint; defaults to the wallet provider's. */
  horizonUrl?: string;
  /** Poll interval in ms. Omit or pass null to fetch once; floored at 5s. */
  pollIntervalMs?: number | null;
  /** Optional custom handler invoked on deposit. */
  onDeposit?: (poolId: string, params: DepositParams) => Promise<void>;
  /** Optional custom handler invoked on withdraw. */
  onWithdraw?: (poolId: string, params: WithdrawParams) => Promise<void>;
}

export interface UseLiquidityPoolReturn {
  pool: LiquidityPoolData | null;
  userShares: string;
  sharePercentage: number;
  estimatedReserves: PoolReserve[];
  loading: boolean;
  error: Error | null;
  submitting: boolean;
  actionError: Error | null;
  refresh: () => Promise<void>;
  stopPolling: () => void;
  deposit: (params: DepositParams) => Promise<void>;
  withdraw: (params: WithdrawParams) => Promise<void>;
}

const MIN_POLL_INTERVAL_MS = 5000;

function parseHorizonAsset(raw: string): { code: string; issuer?: string } {
  if (raw === 'native') {
    return { code: 'XLM' };
  }
  const [code, issuer] = raw.split(':');
  return { code: code || raw, issuer };
}

function computeEstimatedReserves(
  pool: LiquidityPoolData | null,
  userShares: string,
): { sharePercentage: number; estimatedReserves: PoolReserve[] } {
  if (!pool) {
    return { sharePercentage: 0, estimatedReserves: [] };
  }
  const total = Number(pool.totalShares);
  const owned = Number(userShares);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(owned) || owned <= 0) {
    return {
      sharePercentage: 0,
      estimatedReserves: pool.reserves.map((r) => ({ ...r, amount: '0' })),
    };
  }
  const ratio = owned / total;
  return {
    sharePercentage: ratio * 100,
    estimatedReserves: pool.reserves.map((r) => {
      const reserveAmt = Number(r.amount);
      const est = Number.isFinite(reserveAmt) ? (reserveAmt * ratio).toFixed(7) : '0';
      return { ...r, amount: est };
    }),
  };
}

/**
 * Hook to query a Stellar Horizon liquidity pool, the connected user's share
 * of that pool, and trigger deposit / withdraw actions.
 */
export function useLiquidityPool(
  poolId: string | null | undefined,
  opts: UseLiquidityPoolOptions = {},
): UseLiquidityPoolReturn {
  const providerConfig = useWalletConfig();
  const {
    publicKey = null,
    horizonUrl = providerConfig?.horizonUrl ?? 'https://horizon.stellar.org',
    pollIntervalMs = null,
    onDeposit,
    onWithdraw,
  } = opts;

  const [pool, setPool] = useState<LiquidityPoolData | null>(null);
  const [userShares, setUserShares] = useState<string>('0');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<Error | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPool = useCallback(async () => {
    if (!poolId) {
      setPool(null);
      setUserShares('0');
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const poolRes = await fetch(`${horizonUrl}/liquidity_pools/${encodeURIComponent(poolId)}`);
      if (!poolRes.ok) {
        throw new Error(`Horizon error ${poolRes.status}`);
      }
      const data = await poolRes.json();

      const reserves: PoolReserve[] = Array.isArray(data.reserves)
        ? data.reserves.map((r: { asset: string; amount: string }) => ({
            asset: r.asset,
            ...parseHorizonAsset(r.asset),
            amount: r.amount,
          }))
        : [];

      const parsedPool: LiquidityPoolData = {
        id: data.id ?? poolId,
        feeBp: Number(data.fee_bp ?? 30),
        type: data.type ?? 'constant_product',
        totalTrustlines: String(data.total_trustlines ?? '0'),
        totalShares: String(data.total_shares ?? '0'),
        reserves,
      };

      let shares = '0';
      if (publicKey) {
        const acctRes = await fetch(`${horizonUrl}/accounts/${encodeURIComponent(publicKey)}`);
        if (acctRes.ok) {
          const acctData = await acctRes.json();
          const shareBalance = Array.isArray(acctData.balances)
            ? acctData.balances.find(
                (b: { asset_type?: string; liquidity_pool_id?: string; balance?: string }) =>
                  b.asset_type === 'liquidity_pool_shares' && b.liquidity_pool_id === poolId,
              )
            : undefined;
          if (shareBalance?.balance) {
            shares = String(shareBalance.balance);
          }
        }
      }

      setPool(parsedPool);
      setUserShares(shares);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [poolId, publicKey, horizonUrl]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    await fetchPool();
  }, [fetchPool]);

  useEffect(() => {
    fetchPool();
    if (pollIntervalMs && pollIntervalMs > 0) {
      const interval = Math.max(pollIntervalMs, MIN_POLL_INTERVAL_MS);
      pollTimer.current = setInterval(fetchPool, interval);
    }
    return () => stopPolling();
  }, [fetchPool, pollIntervalMs, stopPolling]);

  const deposit = useCallback(
    async (params: DepositParams) => {
      if (!poolId) {
        throw new Error('No liquidity pool selected');
      }
      if (!onDeposit) {
        throw new Error('Deposit handler is not configured');
      }
      setSubmitting(true);
      setActionError(null);
      try {
        await onDeposit(poolId, params);
        await fetchPool();
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setActionError(e);
        throw e;
      } finally {
        setSubmitting(false);
      }
    },
    [poolId, onDeposit, fetchPool],
  );

  const withdraw = useCallback(
    async (params: WithdrawParams) => {
      if (!poolId) {
        throw new Error('No liquidity pool selected');
      }
      if (!onWithdraw) {
        throw new Error('Withdraw handler is not configured');
      }
      setSubmitting(true);
      setActionError(null);
      try {
        await onWithdraw(poolId, params);
        await fetchPool();
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setActionError(e);
        throw e;
      } finally {
        setSubmitting(false);
      }
    },
    [poolId, onWithdraw, fetchPool],
  );

  const { sharePercentage, estimatedReserves } = computeEstimatedReserves(pool, userShares);

  return {
    pool,
    userShares,
    sharePercentage,
    estimatedReserves,
    loading,
    error,
    submitting,
    actionError,
    refresh,
    stopPolling,
    deposit,
    withdraw,
  };
}
