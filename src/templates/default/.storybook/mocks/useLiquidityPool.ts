import { useState, useCallback, useEffect } from 'react';
import type {
  LiquidityPoolData,
  PoolReserve,
  DepositParams,
  WithdrawParams,
  UseLiquidityPoolOptions,
  UseLiquidityPoolReturn,
} from '../../src/hooks/useLiquidityPool';

export type LiquidityPoolScenario =
  | 'loading'
  | 'empty'
  | 'error'
  | 'populated'
  | 'no-position';

let activeScenario: LiquidityPoolScenario = 'populated';

export function __setLiquidityPoolScenario(scenario: LiquidityPoolScenario): void {
  activeScenario = scenario;
}

const SAMPLE_POOL: LiquidityPoolData = {
  id: 'dd7b1ab831c273310ddbec6f97870aa83c2fbd78ce22aded37ecbf4f3380fac7',
  feeBp: 30,
  type: 'constant_product',
  totalTrustlines: '142',
  totalShares: '50000.0000000',
  reserves: [
    { asset: 'native', code: 'XLM', amount: '250000.0000000' },
    {
      asset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      code: 'USDC',
      issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      amount: '30000.0000000',
    },
  ],
};

function computeState(scenario: LiquidityPoolScenario): {
  pool: LiquidityPoolData | null;
  userShares: string;
  sharePercentage: number;
  estimatedReserves: PoolReserve[];
  loading: boolean;
  error: Error | null;
} {
  switch (scenario) {
    case 'loading':
      return {
        pool: null,
        userShares: '0',
        sharePercentage: 0,
        estimatedReserves: [],
        loading: true,
        error: null,
      };
    case 'empty':
      return {
        pool: null,
        userShares: '0',
        sharePercentage: 0,
        estimatedReserves: [],
        loading: false,
        error: null,
      };
    case 'error':
      return {
        pool: null,
        userShares: '0',
        sharePercentage: 0,
        estimatedReserves: [],
        loading: false,
        error: new Error('Failed to reach Horizon testnet'),
      };
    case 'no-position':
      return {
        pool: SAMPLE_POOL,
        userShares: '0',
        sharePercentage: 0,
        estimatedReserves: SAMPLE_POOL.reserves.map((r) => ({ ...r, amount: '0' })),
        loading: false,
        error: null,
      };
    case 'populated':
    default:
      return {
        pool: SAMPLE_POOL,
        userShares: '1250.0000000',
        sharePercentage: 2.5,
        estimatedReserves: [
          { asset: 'native', code: 'XLM', amount: '6250.0000000' },
          {
            asset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            code: 'USDC',
            issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
            amount: '750.0000000',
          },
        ],
        loading: false,
        error: null,
      };
  }
}

export function useLiquidityPool(
  _poolId: string | null | undefined,
  opts: UseLiquidityPoolOptions = {},
): UseLiquidityPoolReturn {
  const compute = useCallback(() => computeState(activeScenario), []);
  const [state, setState] = useState(compute);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  useEffect(() => {
    setState(compute());
  }, [compute]);

  const refresh = useCallback(async () => {
    setState(compute());
  }, [compute]);

  const stopPolling = useCallback(() => {}, []);

  const deposit = useCallback(
    async (params: DepositParams) => {
      setSubmitting(true);
      setActionError(null);
      try {
        if (opts.onDeposit) {
          await opts.onDeposit(SAMPLE_POOL.id, params);
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setActionError(e);
        throw e;
      } finally {
        setSubmitting(false);
      }
    },
    [opts],
  );

  const withdraw = useCallback(
    async (params: WithdrawParams) => {
      setSubmitting(true);
      setActionError(null);
      try {
        if (opts.onWithdraw) {
          await opts.onWithdraw(SAMPLE_POOL.id, params);
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setActionError(e);
        throw e;
      } finally {
        setSubmitting(false);
      }
    },
    [opts],
  );

  return {
    ...state,
    submitting,
    actionError,
    refresh,
    stopPolling,
    deposit,
    withdraw,
  };
}
