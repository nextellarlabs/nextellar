import { useState } from 'react';
import type { ClaimableBalance } from '../../src/hooks/useClaimableBalances';

export type ClaimableScenario = 'loading' | 'empty' | 'error' | 'populated';
let scenario: ClaimableScenario = 'populated';

export function __setClaimableScenario(next: ClaimableScenario) {
  scenario = next;
}

const ADDRESS = 'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ';
const sample: ClaimableBalance[] = [
  { id: 'eligible', asset: 'native', amount: '12.5000000', claimants: [{ destination: ADDRESS, predicate: { unconditional: true } }] },
  { id: 'pending', asset: 'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', amount: '25.0000000', claimants: [{ destination: ADDRESS, predicate: { abs_before: '2020-01-01T00:00:00Z' } }] },
];

export function useClaimableBalances() {
  const [balances, setBalances] = useState(scenario === 'populated' ? sample : []);
  const [claimedId, setClaimedId] = useState<string | null>(null);
  return {
    balances,
    loading: scenario === 'loading',
    error: scenario === 'error' ? new Error('Horizon unavailable') : null,
    refresh: async () => {},
    claim: async (id: string) => { setBalances((current) => current.filter((item) => item.id !== id)); setClaimedId(id); },
    claimingId: null,
    claimError: null,
    claimedId,
  };
}
