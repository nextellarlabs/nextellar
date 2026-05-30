/**
 * Canonical role identifiers used by the RBAC middleware.
 *
 * Roles are strings rather than a numeric enum because they show up
 * verbatim in JWT payloads, audit logs, and policy documents — a name
 * is easier to grep for than a small integer.
 */
export const Roles = {
  /** Read-only end user of the Nextellar dApp. */
  User: 'user',
  /** Trusted reporter / verifier with elevated mutation rights. */
  Moderator: 'moderator',
  /** Full administrative access. */
  Admin: 'admin',
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];

const ROLE_VALUES = new Set<string>(Object.values(Roles));

/**
 * Narrow an unknown value (e.g. a JWT claim) to a known {@link Role}.
 * Returns null for anything outside the {@link Roles} catalogue.
 */
export function asRole(value: unknown): Role | null {
  if (typeof value !== 'string') return null;
  return ROLE_VALUES.has(value) ? (value as Role) : null;
}
