/** @jest-environment jsdom */
import { canClaimBalance, type ClaimableBalance, type ClaimPredicate } from '../hooks/useClaimableBalances';

const ADDRESS = 'GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ';
const NOW = Date.parse('2026-01-01T00:00:00Z');

function balance(predicate: ClaimPredicate, created_at?: string): ClaimableBalance {
  return {
    id: 'balance-id', asset: 'native', amount: '1.0000000', created_at,
    claimants: [{ destination: ADDRESS, predicate }],
  };
}

describe('canClaimBalance', () => {
  it('requires the requested account to be a claimant', () => {
    expect(canClaimBalance(balance({ unconditional: true }), 'GOTHER', NOW)).toBe(false);
    expect(canClaimBalance(balance({ unconditional: true }), ADDRESS, NOW)).toBe(true);
  });

  it('handles absolute and relative deadlines', () => {
    expect(canClaimBalance(balance({ abs_before: '2026-01-02T00:00:00Z' }), ADDRESS, NOW)).toBe(true);
    expect(canClaimBalance(balance({ abs_before: '2025-12-31T00:00:00Z' }), ADDRESS, NOW)).toBe(false);
    expect(canClaimBalance(balance({ rel_before: '3600' }, '2025-12-31T23:30:00Z'), ADDRESS, NOW)).toBe(true);
    expect(canClaimBalance(balance({ rel_before: '3600' }, '2025-12-31T22:00:00Z'), ADDRESS, NOW)).toBe(false);
    expect(canClaimBalance(balance({ rel_before: '3600' }), ADDRESS, NOW)).toBe(false);
  });

  it('evaluates nested predicates and fails closed on unknown values', () => {
    expect(canClaimBalance(balance({ and: [{ unconditional: true }, { not: { unconditional: false } }] }), ADDRESS, NOW)).toBe(true);
    expect(canClaimBalance(balance({ or: [{ unconditional: false }, { unconditional: true }] }), ADDRESS, NOW)).toBe(true);
    expect(canClaimBalance(balance({ not: { rel_before: '3600' } }), ADDRESS, NOW)).toBe(false);
    expect(canClaimBalance(balance({ and: [] }), ADDRESS, NOW)).toBe(false);
  });
});
