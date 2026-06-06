// routes-d/lib/operationAllowlist.ts
//
// Single source of truth for which Stellar operation types the relay
// endpoints are permitted to prepare and submit. Any operation type not
// present in DEFAULT_ALLOWED_OPERATIONS will be rejected with a 403.
//
// The allowlist is intentionally conservative — only the most common,
// non-destructive operation types are enabled by default. Operators can
// extend it at router construction time via `createAllowlist`.

/** Operation types allowed by default. */
export const DEFAULT_ALLOWED_OPERATIONS: ReadonlySet<string> = new Set([
  'payment',
  'pathPaymentStrictSend',
  'pathPaymentStrictReceive',
  'manageBuyOffer',
  'manageSellOffer',
  'createPassiveSellOffer',
  'changeTrust',
  'manageData',
  'bumpSequence',
  'claimClaimableBalance',
  'invokeHostFunction',
]);

export interface AllowlistCheckResult {
  allowed: boolean;
  /** Operation types that are not in the allowlist (empty when all pass). */
  disallowed: string[];
}

/**
 * Check a list of operation type strings against an allowlist.
 * Pure function — no side effects.
 */
export function checkOperations(
  operationTypes: readonly string[],
  allowlist: ReadonlySet<string> = DEFAULT_ALLOWED_OPERATIONS,
): AllowlistCheckResult {
  const disallowed: string[] = [];
  for (const type of operationTypes) {
    if (!allowlist.has(type)) disallowed.push(type);
  }
  return { allowed: disallowed.length === 0, disallowed };
}

/**
 * Build a custom allowlist by merging the defaults with additional types.
 * Pass `replaceDefaults: true` to start from an empty set instead.
 */
export function createAllowlist(
  extra: Iterable<string> = [],
  replaceDefaults = false,
): Set<string> {
  const base = replaceDefaults ? new Set<string>() : new Set(DEFAULT_ALLOWED_OPERATIONS);
  for (const t of extra) base.add(t);
  return base;
}
