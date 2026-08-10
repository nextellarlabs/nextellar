/**
 * Unit tests for routes-d/lib/featureFlags.ts
 *
 * Covers:
 *  - Stable user bucketing (same userId+flag → same result every call)
 *  - Rollout boundaries (0 %, 100 %, partial cohorts)
 *  - Defaults (enabled flags default to true for all users)
 *  - Hot reload via reloadFlags() + FEATURE_FLAGS_JSON env variable
 *  - getFlagStatus() returns correct metadata
 *  - getFlagsForUser() returns per-user evaluated values
 *  - Unknown flags return false
 *  - __setFlags / __resetFlags test helpers
 */

import {
  isFlagEnabled,
  getFlagsForUser,
  getFlagStatus,
  getRawFlags,
  reloadFlags,
  getBucket,
  __setFlags,
  __resetFlags,
  type FlagMap,
} from '../../lib/featureFlags.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Save and restore process.env.FEATURE_FLAGS_JSON around a block. */
function withEnv(value: string | undefined, fn: () => void): void {
  const original = process.env['FEATURE_FLAGS_JSON'];
  if (value === undefined) {
    delete process.env['FEATURE_FLAGS_JSON'];
  } else {
    process.env['FEATURE_FLAGS_JSON'] = value;
  }
  try {
    fn();
  } finally {
    if (original === undefined) {
      delete process.env['FEATURE_FLAGS_JSON'];
    } else {
      process.env['FEATURE_FLAGS_JSON'] = original;
    }
    // Restore module state to defaults after env manipulation.
    __resetFlags();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('featureFlags – getBucket', () => {
  it('returns a number in [0, 100)', () => {
    for (const userId of ['alice', 'bob', 'carol', 'user-99', '']) {
      const b = getBucket(userId, 'some-flag');
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it('is deterministic – same inputs always yield the same bucket', () => {
    const ids = ['user-1', 'user-2', 'user-abc', 'user-xyz'];
    const flag = 'wallet-backup-prompt';

    for (const id of ids) {
      const first = getBucket(id, flag);
      const second = getBucket(id, flag);
      const third = getBucket(id, flag);
      expect(first).toBe(second);
      expect(second).toBe(third);
    }
  });

  it('produces different buckets for different flags on the same user', () => {
    const buckets = [
      getBucket('user-1', 'flag-a'),
      getBucket('user-1', 'flag-b'),
      getBucket('user-1', 'flag-c'),
    ];
    // They should not all be the same
    const unique = new Set(buckets);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('produces different buckets for different users on the same flag', () => {
    const flag = 'stellar-soroban-v2';
    const buckets = new Set([
      getBucket('user-1', flag),
      getBucket('user-2', flag),
      getBucket('user-3', flag),
      getBucket('user-4', flag),
      getBucket('user-5', flag),
    ]);
    expect(buckets.size).toBeGreaterThan(1);
  });
});

describe('featureFlags – isFlagEnabled', () => {
  beforeEach(() => {
    __resetFlags();
  });

  it('returns false for an unknown flag', () => {
    expect(isFlagEnabled('no-such-flag', 'user-1')).toBe(false);
  });

  it('returns false when flag.enabled is false regardless of rollout', () => {
    __setFlags({
      'disabled-flag': { enabled: false, rollout: 1.0 },
    });
    expect(isFlagEnabled('disabled-flag', 'user-1')).toBe(false);
    expect(isFlagEnabled('disabled-flag', 'user-2')).toBe(false);
  });

  it('returns true for all users when rollout is 1.0', () => {
    __setFlags({
      'full-rollout': { enabled: true, rollout: 1.0 },
    });
    const ids = ['user-1', 'user-2', 'user-3', 'alice', 'bob'];
    for (const id of ids) {
      expect(isFlagEnabled('full-rollout', id)).toBe(true);
    }
  });

  it('returns false for all users when rollout is 0.0', () => {
    __setFlags({
      'zero-rollout': { enabled: true, rollout: 0.0 },
    });
    const ids = ['user-1', 'user-2', 'user-3', 'alice', 'bob'];
    for (const id of ids) {
      expect(isFlagEnabled('zero-rollout', id)).toBe(false);
    }
  });

  it('uses bucket < rollout * 100 to determine inclusion', () => {
    // For 'test-flag' find a user whose bucket is in [0,49] and one in [50,99]
    const flag = 'test-flag';
    __setFlags({ [flag]: { enabled: true, rollout: 0.5 } });

    // Scan a range of userIds to find one in each partition
    let inUser: string | null = null;
    let outUser: string | null = null;

    for (let i = 0; i < 200; i++) {
      const uid = `test-user-${i}`;
      const bucket = getBucket(uid, flag);
      if (bucket < 50 && inUser === null) inUser = uid;
      if (bucket >= 50 && outUser === null) outUser = uid;
      if (inUser && outUser) break;
    }

    expect(inUser).not.toBeNull();
    expect(outUser).not.toBeNull();

    expect(isFlagEnabled(flag, inUser!)).toBe(true);
    expect(isFlagEnabled(flag, outUser!)).toBe(false);
  });

  it('is stable across repeated calls for the same user', () => {
    __setFlags({
      'stable-flag': { enabled: true, rollout: 0.5 },
    });
    const uid = 'user-stability-test';
    const first = isFlagEnabled('stable-flag', uid);
    for (let i = 0; i < 10; i++) {
      expect(isFlagEnabled('stable-flag', uid)).toBe(first);
    }
  });

  it('defaults to rollout 1.0 when rollout is omitted', () => {
    __setFlags({ 'no-rollout-field': { enabled: true } });
    expect(isFlagEnabled('no-rollout-field', 'any-user')).toBe(true);
    expect(isFlagEnabled('no-rollout-field', 'another-user')).toBe(true);
  });
});

describe('featureFlags – getFlagsForUser', () => {
  beforeEach(() => {
    __resetFlags();
  });

  it('returns an object keyed by all flag names', () => {
    __setFlags({
      'flag-a': { enabled: true, rollout: 1.0 },
      'flag-b': { enabled: false, rollout: 1.0 },
    });
    const result = getFlagsForUser('user-x');
    expect(Object.keys(result)).toEqual(['flag-a', 'flag-b']);
  });

  it('returns correct boolean values per flag', () => {
    __setFlags({
      'on-flag': { enabled: true, rollout: 1.0 },
      'off-flag': { enabled: false, rollout: 1.0 },
    });
    const result = getFlagsForUser('user-x');
    expect(result['on-flag']).toBe(true);
    expect(result['off-flag']).toBe(false);
  });

  it('is stable for the same user across calls', () => {
    __setFlags({
      'partial': { enabled: true, rollout: 0.5 },
    });
    const uid = 'user-stable-check';
    const first = getFlagsForUser(uid);
    const second = getFlagsForUser(uid);
    expect(first).toEqual(second);
  });
});

describe('featureFlags – getFlagStatus', () => {
  beforeEach(() => {
    __resetFlags();
  });

  it('returns all flags in the flags property', () => {
    __setFlags({
      'flag-1': { enabled: true, rollout: 0.25, description: 'desc' },
      'flag-2': { enabled: false, rollout: 0.0 },
    });
    const status = getFlagStatus();
    expect(Object.keys(status.flags)).toContain('flag-1');
    expect(Object.keys(status.flags)).toContain('flag-2');
  });

  it('returns correct metadata for each flag', () => {
    __setFlags({
      'my-flag': { enabled: true, rollout: 0.75, description: 'test flag' },
    });
    const status = getFlagStatus();
    expect(status.flags['my-flag'].enabled).toBe(true);
    expect(status.flags['my-flag'].rollout).toBe(0.75);
    expect(status.flags['my-flag'].description).toBe('test flag');
  });

  it('includes loadedAt as an ISO string', () => {
    const status = getFlagStatus();
    expect(() => new Date(status.loadedAt)).not.toThrow();
    expect(status.loadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('reports source as "default" after __resetFlags', () => {
    __resetFlags();
    const status = getFlagStatus();
    expect(status.source).toBe('default');
  });
});

describe('featureFlags – reloadFlags (hot reload)', () => {
  afterEach(() => {
    delete process.env['FEATURE_FLAGS_JSON'];
    __resetFlags();
  });

  it('loads flags from FEATURE_FLAGS_JSON when set', () => {
    const envFlags: FlagMap = {
      'env-flag': { enabled: true, rollout: 1.0, description: 'from env' },
    };
    process.env['FEATURE_FLAGS_JSON'] = JSON.stringify(envFlags);

    const loaded = reloadFlags();
    expect(loaded).toBe(true);

    const raw = getRawFlags();
    expect(raw['env-flag']).toBeDefined();
    expect(raw['env-flag'].enabled).toBe(true);
  });

  it('returns true and sets source to "env" when env flags are valid', () => {
    process.env['FEATURE_FLAGS_JSON'] = JSON.stringify({
      'x': { enabled: true },
    });
    const loaded = reloadFlags();
    expect(loaded).toBe(true);
    expect(getFlagStatus().source).toBe('env');
  });

  it('falls back to defaults when FEATURE_FLAGS_JSON is invalid JSON', () => {
    process.env['FEATURE_FLAGS_JSON'] = 'not-valid-json{{';
    const loaded = reloadFlags();
    expect(loaded).toBe(false);
    expect(getFlagStatus().source).toBe('default');
  });

  it('falls back to defaults when FEATURE_FLAGS_JSON is an empty object', () => {
    process.env['FEATURE_FLAGS_JSON'] = JSON.stringify({});
    const loaded = reloadFlags();
    expect(loaded).toBe(false);
    expect(getFlagStatus().source).toBe('default');
  });

  it('falls back to defaults when FEATURE_FLAGS_JSON is not set', () => {
    delete process.env['FEATURE_FLAGS_JSON'];
    const loaded = reloadFlags();
    expect(loaded).toBe(false);
    expect(getFlagStatus().source).toBe('default');
  });

  it('reflects new flags immediately after reload', () => {
    __setFlags({ 'old-flag': { enabled: true } });
    expect(isFlagEnabled('old-flag', 'user-1')).toBe(true);

    process.env['FEATURE_FLAGS_JSON'] = JSON.stringify({
      'new-flag': { enabled: true, rollout: 1.0 },
    });
    reloadFlags();

    // Old flag should be gone, new flag should be present.
    expect(isFlagEnabled('old-flag', 'user-1')).toBe(false);
    expect(isFlagEnabled('new-flag', 'user-1')).toBe(true);
  });

  it('multiple consecutive reloads are each independent', () => {
    withEnv(
      JSON.stringify({ 'reload-a': { enabled: true, rollout: 1.0 } }),
      () => {
        reloadFlags();
        expect(isFlagEnabled('reload-a', 'u1')).toBe(true);
      },
    );

    withEnv(
      JSON.stringify({ 'reload-b': { enabled: true, rollout: 1.0 } }),
      () => {
        reloadFlags();
        expect(isFlagEnabled('reload-b', 'u1')).toBe(true);
        expect(isFlagEnabled('reload-a', 'u1')).toBe(false);
      },
    );
  });
});

describe('featureFlags – default flag definitions', () => {
  beforeEach(() => {
    __resetFlags();
  });

  it('stellar-soroban-v2 is enabled for all users by default', () => {
    expect(isFlagEnabled('stellar-soroban-v2', 'alice')).toBe(true);
    expect(isFlagEnabled('stellar-soroban-v2', 'bob')).toBe(true);
  });

  it('defi-yield-farming is disabled for all users by default', () => {
    expect(isFlagEnabled('defi-yield-farming', 'alice')).toBe(false);
    expect(isFlagEnabled('defi-yield-farming', 'bob')).toBe(false);
  });

  it('notification-prefs-v2 is enabled for all users by default', () => {
    expect(isFlagEnabled('notification-prefs-v2', 'alice')).toBe(true);
  });
});
