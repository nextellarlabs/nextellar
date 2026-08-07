/**
 * Feature Flag Service – routes-d/lib/featureFlags.ts
 *
 * Provides stable per-user bucketing and hot-reload of flag definitions from
 * environment variables.
 *
 * Flag values are sourced from process.env:
 *
 *   FEATURE_FLAGS_JSON  – JSON string: { "flag-name": { "enabled": true, "rollout": 0.5 } }
 *
 * When FEATURE_FLAGS_JSON is absent or unparseable the service falls back to
 * DEFAULT_FLAG_DEFINITIONS, so tests and local dev work with zero config.
 *
 * Bucketing algorithm
 * -------------------
 * A user is "in" a flag when:
 *
 *   hash(userId + flagName) % 100  <  rollout * 100
 *
 * where hash() is a stable, deterministic 32-bit integer derived from the string.
 * The same userId + flagName pair always produces the same bucket, regardless of
 * how many times the service is reloaded.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FlagDefinition {
  /** Whether the flag exists and is active at all. */
  enabled: boolean;
  /**
   * Fraction of users that should see this flag (0.0 – 1.0).
   * 1.0 = everyone, 0.0 = nobody.  Defaults to 1.0 when omitted.
   */
  rollout?: number;
  /** Optional human-readable description for the /flags/status endpoint. */
  description?: string;
}

export interface FlagMap {
  [flagName: string]: FlagDefinition;
}

export interface FlagStatus {
  flags: Record<
    string,
    {
      enabled: boolean;
      rollout: number;
      description: string;
    }
  >;
  loadedAt: string;
  source: 'env' | 'default';
}

// ---------------------------------------------------------------------------
// Default flag definitions (used when no env is present)
// ---------------------------------------------------------------------------

const DEFAULT_FLAG_DEFINITIONS: FlagMap = {
  'stellar-soroban-v2': {
    enabled: true,
    rollout: 1.0,
    description: 'Enable Soroban v2 contract interactions',
  },
  'wallet-backup-prompt': {
    enabled: true,
    rollout: 0.5,
    description: 'Show wallet backup reminder prompt to 50 % of users',
  },
  'defi-yield-farming': {
    enabled: false,
    rollout: 0.0,
    description: 'DeFi yield farming – currently disabled',
  },
  'notification-prefs-v2': {
    enabled: true,
    rollout: 1.0,
    description: 'Notification preferences v2 UI',
  },
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _flags: FlagMap = { ...DEFAULT_FLAG_DEFINITIONS };
let _loadedAt: Date = new Date();
let _source: 'env' | 'default' = 'default';

// ---------------------------------------------------------------------------
// Deterministic hash helpers
// ---------------------------------------------------------------------------

/**
 * djb2-style 32-bit hash of an arbitrary string.
 * Always returns a non-negative integer.
 */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    // (h << 5) + h  =  h * 33
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; // keep unsigned 32-bit
  }
  return h;
}

/**
 * Maps a userId + flagName to a bucket in [0, 100).
 * This value is stable as long as the inputs don't change.
 */
export function getBucket(userId: string, flagName: string): number {
  return hashString(`${userId}:${flagName}`) % 100;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Parse and validate a raw FlagMap-shaped value.
 * Returns null if the value cannot be coerced into a valid FlagMap.
 */
function parseFlagMap(raw: unknown): FlagMap | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }

  const result: FlagMap = {};

  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val !== 'object' || val === null) continue;
    const v = val as Record<string, unknown>;

    if (typeof v.enabled !== 'boolean') continue;

    const rollout =
      typeof v.rollout === 'number'
        ? Math.max(0, Math.min(1, v.rollout))
        : 1.0;

    result[key] = {
      enabled: v.enabled,
      rollout,
      description: typeof v.description === 'string' ? v.description : '',
    };
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * (Re)load flag definitions from FEATURE_FLAGS_JSON environment variable.
 *
 * This is the "hot reload" entry-point – call it whenever you want the service
 * to pick up a new config (e.g. on SIGHUP, periodically, or in a test).
 *
 * @returns `true` when env-provided flags were loaded, `false` when falling
 *          back to defaults.
 */
export function reloadFlags(): boolean {
  const raw = process.env['FEATURE_FLAGS_JSON'];

  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const flags = parseFlagMap(parsed);

      if (flags) {
        _flags = flags;
        _loadedAt = new Date();
        _source = 'env';
        return true;
      }
    } catch {
      // fall through to defaults
    }
  }

  _flags = { ...DEFAULT_FLAG_DEFINITIONS };
  _loadedAt = new Date();
  _source = 'default';
  return false;
}

// Perform initial load at module initialisation time.
reloadFlags();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a named flag is enabled for a specific user.
 *
 * A flag is enabled for a user when:
 *   1. The flag definition exists and its `enabled` property is `true`.
 *   2. The user falls within the flag's rollout percentage (stable bucketing).
 *
 * Unknown flags are treated as disabled (returns `false`).
 */
export function isFlagEnabled(flagName: string, userId: string): boolean {
  const def = _flags[flagName];
  if (!def || !def.enabled) return false;

  const rollout = def.rollout ?? 1.0;
  if (rollout >= 1.0) return true;
  if (rollout <= 0.0) return false;

  const bucket = getBucket(userId, flagName);
  return bucket < rollout * 100;
}

/**
 * Return all flags and their evaluated state for a specific user.
 * Useful for the /flags/status endpoint when an authenticated user is present.
 */
export function getFlagsForUser(userId: string): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const flagName of Object.keys(_flags)) {
    result[flagName] = isFlagEnabled(flagName, userId);
  }
  return result;
}

/**
 * Return a snapshot of all current flag definitions and metadata.
 * This is the raw config view – no user bucketing applied.
 */
export function getFlagStatus(): FlagStatus {
  const flags: FlagStatus['flags'] = {};

  for (const [name, def] of Object.entries(_flags)) {
    flags[name] = {
      enabled: def.enabled,
      rollout: def.rollout ?? 1.0,
      description: def.description ?? '',
    };
  }

  return {
    flags,
    loadedAt: _loadedAt.toISOString(),
    source: _source,
  };
}

/**
 * Return the raw flag definition map (for testing / introspection).
 */
export function getRawFlags(): Readonly<FlagMap> {
  return { ..._flags };
}

// ---------------------------------------------------------------------------
// Test helpers  (prefixed with __ by convention in this codebase)
// ---------------------------------------------------------------------------

/**
 * Override the entire flag map.  Useful in tests to inject known state.
 */
export function __setFlags(flags: FlagMap): void {
  _flags = { ...flags };
  _loadedAt = new Date();
  _source = 'default';
}

/**
 * Reset to the module defaults (DEFAULT_FLAG_DEFINITIONS).
 */
export function __resetFlags(): void {
  _flags = { ...DEFAULT_FLAG_DEFINITIONS };
  _loadedAt = new Date();
  _source = 'default';
}
