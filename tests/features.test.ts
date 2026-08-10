import {
  getFeature,
  getFeatureIds,
  listFeatures,
  resolveFeatureWithDeps,
  type FeatureDef,
} from '../src/lib/features.js';

const orderOf = (ids: string[], id: string) => ids.indexOf(id);

describe('feature registry', () => {
  it('registers the UI component features alongside the hook features', () => {
    const ids = getFeatureIds();

    expect(ids).toEqual(
      expect.arrayContaining(['wallet', 'balances', 'payments', 'history'])
    );
    expect(ids).toEqual(
      expect.arrayContaining([
        'components',
        'network-switcher',
        'balance-display',
        'send-form',
        'transaction-list',
      ])
    );
  });

  it('marks component features so `add --list` can group them', () => {
    const byId = Object.fromEntries(listFeatures().map((f) => [f.id, f]));

    expect(byId['wallet'].kind).toBe('hook');
    expect(byId['components'].kind).toBe('component');
    expect(byId['send-form'].kind).toBe('component');
    expect(byId['send-form'].description).toEqual(expect.any(String));
  });

  it('points component features at components/*.tsx', () => {
    expect(getFeature('balance-display')?.files).toEqual([
      'components/BalanceDisplay.tsx',
    ]);
    expect(getFeature('send-form')?.files).toEqual(['components/SendForm.tsx']);
    expect(getFeature('transaction-list')?.files).toEqual([
      'components/TransactionList.tsx',
    ]);
    expect(getFeature('network-switcher')?.files).toEqual([
      'components/NetworkSwitcher.tsx',
    ]);
  });

  it('ties each component to the hook feature it renders', () => {
    expect(getFeature('balance-display')?.dependsOn).toContain('balances');
    expect(getFeature('send-form')?.dependsOn).toContain('payments');
    expect(getFeature('transaction-list')?.dependsOn).toContain('history');
    expect(getFeature('network-switcher')?.dependsOn).toContain('wallet');
  });

  describe('resolveFeatureWithDeps', () => {
    it('returns an empty list for an unknown feature', () => {
      expect(resolveFeatureWithDeps('nope')).toEqual([]);
    });

    it('puts a component after the hook feature it depends on', () => {
      const ids = resolveFeatureWithDeps('transaction-list').map((f) => f.id);

      expect(ids).toEqual(['wallet', 'history', 'transaction-list']);
      expect(orderOf(ids, 'history')).toBeLessThan(
        orderOf(ids, 'transaction-list')
      );
    });

    it('resolves the components umbrella with every hook before its component', () => {
      const ids = resolveFeatureWithDeps('components').map((f) => f.id);

      expect(ids).toEqual(
        expect.arrayContaining([
          'wallet',
          'balances',
          'payments',
          'history',
          'network-switcher',
          'balance-display',
          'send-form',
          'transaction-list',
          'components',
        ])
      );

      const pairs: [string, string][] = [
        ['wallet', 'network-switcher'],
        ['balances', 'balance-display'],
        ['payments', 'send-form'],
        ['history', 'transaction-list'],
      ];
      for (const [hook, component] of pairs) {
        expect(orderOf(ids, hook)).toBeGreaterThanOrEqual(0);
        expect(orderOf(ids, hook)).toBeLessThan(orderOf(ids, component));
      }

      // The umbrella itself is installed last and contributes no files.
      expect(ids[ids.length - 1]).toBe('components');
      expect(getFeature('components')?.files).toEqual([]);
    });

    it('lists each feature once even when several components share a hook', () => {
      const ids = resolveFeatureWithDeps('components').map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('terminates on a cyclic registry instead of infinite-looping', () => {
      // Synthetic registry with a root <-> loop cycle. Without the visiting
      // guard this would recurse forever; with it, resolution must return.
      const cyclic: Record<string, FeatureDef> = {
        root: { id: 'root', description: 'root', files: [], dependsOn: ['loop'], npmDependencies: [] },
        loop: { id: 'loop', description: 'loop', files: [], dependsOn: ['root'], npmDependencies: [] },
      };

      const ids = resolveFeatureWithDeps('root', cyclic).map((f) => f.id);

      // The guarantee is termination with each node emitted exactly once; the
      // exact order is post-order (deps first), but we assert set-membership so
      // the test isn't brittle to ordering.
      expect(ids).toHaveLength(2);
      expect(new Set(ids)).toEqual(new Set(['root', 'loop']));
    });
  });
});
