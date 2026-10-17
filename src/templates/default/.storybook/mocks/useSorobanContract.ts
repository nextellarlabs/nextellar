import { useState, useCallback } from 'react';
import type {
  SorobanContractOptions,
  SorobanContractReturn,
  SimulateContractCallResult,
  TypedArg,
} from '../../src/hooks/useSorobanContract';

export type { SimulateContractCallResult, TypedArg };

export type ContractScenario = 'idle' | 'simulating' | 'error' | 'submitting';

// Module-level scenario switch, set by ContractCallForm stories so a single
// mock hook can drive every visual state without touching Soroban RPC.
let activeScenario: ContractScenario = 'idle';

export function __setContractScenario(scenario: ContractScenario): void {
  activeScenario = scenario;
}

// An `increment` call on the Soroban example counter contract: its u32 return
// value decodes to a plain number.
const SIMULATION: SimulateContractCallResult = {
  result: 3,
  minResourceFee: '48213',
  latestLedger: 1284561,
};

const SIMULATION_ERROR_MESSAGE = 'Simulation failed: HostError: Error(Contract, #2)';

const UNSIGNED_XDR = 'AAAAAgAAAADZ0C2S7ErUfXvPKnNXLAXEEFoLKpDLiIfvtxc0mgv1AQAAAGQAAAAAAAAAAQ';

function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

// Storybook-only stand-in for the real useSorobanContract hook. The real hook
// simulates and builds against a live Soroban RPC; this mock resolves with
// deterministic data per the active scenario so ContractCallForm can be
// previewed offline. Nothing is ever signed or submitted.
export function useSorobanContract(_opts: SorobanContractOptions): SorobanContractReturn {
  const [loading] = useState(() => activeScenario === 'simulating');
  const [error, setError] = useState<Error | null>(() =>
    activeScenario === 'error' ? new Error(SIMULATION_ERROR_MESSAGE) : null,
  );

  const simulateContractCall = useCallback(
    async (_name: string, _args: TypedArg[] = []): Promise<SimulateContractCallResult> => {
      setError(null);
      if (activeScenario === 'simulating') return never();
      if (activeScenario === 'error') {
        const err = new Error(SIMULATION_ERROR_MESSAGE);
        setError(err);
        throw err;
      }
      return SIMULATION;
    },
    [],
  );

  const buildInvokeXDR = useCallback(
    async (_name: string, _args: TypedArg[] = []): Promise<string> =>
      activeScenario === 'submitting' ? never() : UNSIGNED_XDR,
    [],
  );

  const callFunction = useCallback(
    async (_name: string, _args: TypedArg[] = []): Promise<unknown> => SIMULATION.result,
    [],
  );

  const submitInvokeWithSecret = useCallback(async (): Promise<never> => {
    throw new Error('submitInvokeWithSecret is disabled in Storybook');
  }, []);

  return {
    callFunction,
    simulateContractCall,
    buildInvokeXDR,
    submitInvokeWithSecret,
    loading,
    error,
  };
}
