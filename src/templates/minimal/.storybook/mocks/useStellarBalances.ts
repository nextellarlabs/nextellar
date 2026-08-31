import { useState, useCallback, useEffect } from 'react';

export type Balance = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  limit?: string;
};

export type BalanceScenario = 'loading' | 'empty' | 'populated' | 'error';

// Module-level scenario switch, set by BalanceDisplay stories so a single mock
// hook can drive every visual state without touching the real network.
let activeScenario: BalanceScenario = 'populated';

export function __setBalanceScenario(scenario: BalanceScenario): void {
  activeScenario = scenario;
}

const SAMPLE_BALANCES: Balance[] = [
  { asset_type: 'native', balance: '1250.4320000' },
  {
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    asset_issuer: 'GDQERENN7FKODGHLXHT5PCZINHD4PPUFDTCF4KPIIDV4LTI3MQTVVXBA',
    balance: '320.5000000',
    limit: '1000.0000000',
  },
];

function computeState(scenario: BalanceScenario): {
  balances: Balance[];
  loading: boolean;
  error: Error | null;
} {
  switch (scenario) {
    case 'loading':
      return { balances: [], loading: true, error: null };
    case 'empty':
      return { balances: [], loading: false, error: null };
    case 'error':
      return {
        balances: [],
        loading: false,
        error: new Error('Failed to reach Horizon testnet'),
      };
    case 'populated':
    default:
      return { balances: SAMPLE_BALANCES, loading: false, error: null };
  }
}

// Storybook-only stand-in for the real useStellarBalances hook. The real hook
// performs a live Horizon RPC call; this mock returns deterministic data per
// the active scenario so BalanceDisplay can be previewed offline.
export function useStellarBalances(
  _publicKey?: string | null,
  _options: { horizonUrl?: string; pollIntervalMs?: number | null } = {},
) {
  const compute = useCallback(() => computeState(activeScenario), []);

  const [state, setState] = useState(compute);
  useEffect(() => {
    setState(compute());
  }, [compute]);

  const refresh = useCallback(() => {
    setState(compute());
  }, [compute]);
  const stopPolling = useCallback(() => {}, []);

  return { ...state, refresh, stopPolling };
}
