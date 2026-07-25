import {
  listFeatures,
  resolveFeatureWithDeps,
  type FeatureDef,
} from '../src/lib/features';

describe('feature dependency resolution', () => {
  it('returns an empty array for an unknown feature id', () => {
    expect(resolveFeatureWithDeps('unknown')).toEqual([]);
  });

  it('resolves feature ids case-insensitively', () => {
    const resolved = resolveFeatureWithDeps('WALLET');
    expect(resolved.map((feature) => feature.id)).toEqual(['wallet']);
  });

  it('places dependencies before dependents', () => {
    const resolved = resolveFeatureWithDeps('balances');
    expect(resolved.map((feature) => feature.id)).toEqual(['wallet', 'balances']);
  });

  it('does not duplicate a dependency when multiple features share it', () => {
    const resolved = resolveFeatureWithDeps('defi');
    expect(resolved.map((feature) => feature.id)).toEqual(['wallet', 'defi']);
  });

  it('returns just itself when a feature has no dependencies', () => {
    const resolved = resolveFeatureWithDeps('history');
    expect(resolved.map((feature) => feature.id)).toEqual(['history']);
  });

  it('does not infinite-loop on a synthetic cyclic registry entry', () => {
    const registry: Record<string, FeatureDef> = {
      root: {
        id: 'root',
        description: 'root',
        files: [],
        dependsOn: ['loop'],
        npmDependencies: [],
      },
      loop: {
        id: 'loop',
        description: 'loop',
        files: [],
        dependsOn: ['root'],
        npmDependencies: [],
      },
    };

    expect(resolveFeatureWithDeps('root', registry).map((feature) => feature.id)).toEqual(['root', 'loop']);
  });
});

describe('feature registry listing', () => {
  it('returns an id and description for every registry entry', () => {
    const features = listFeatures();

    expect(features).toHaveLength(7);
    expect(features).toEqual([
      { id: 'wallet', description: 'Wallet connection: WalletProvider, WalletConnectButton, stellar-wallet-kit, useStellarWallet' },
      { id: 'balances', description: 'Account balances: useStellarBalances hook' },
      { id: 'payments', description: 'Send payments: useStellarPayment hook' },
      { id: 'history', description: 'Transaction history: useTransactionHistory hook' },
      { id: 'trustlines', description: 'Trust lines: useTrustlines hook' },
      { id: 'defi', description: 'DEX / order book: useOfferBook and useTrustlines' },
      { id: 'contracts', description: 'Soroban contracts: useSorobanContract, useSorobanEvents' },
    ]);
  });
});
