// routes-d/lib/identity.ts
//
// Maps external OAuth provider identities to Nextellar user records
// (Issue #260).
//
// An "identity" is the combination of (provider, providerUserId) that
// uniquely identifies a user within a given OAuth provider. On first
// sign-in a new Nextellar account is created and linked; on subsequent
// sign-ins the existing account is returned.
//
// The store is intentionally in-memory so the module stays portable.
// Production deployments replace `identityStore` / `userStore` with
// database-backed implementations that expose the same interface.

import { randomId } from './tokens.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthProfile {
  /** Provider name, e.g. "github", "google". */
  provider: string;
  /** Stable user ID within the provider. */
  providerUserId: string;
  /** Display name from the provider (optional). */
  displayName?: string;
  /** Primary email from the provider (optional). */
  email?: string;
}

export interface NexitellarUser {
  id: string;
  email?: string;
  displayName?: string;
  createdAt: number;
}

export interface IdentityRecord {
  /** Nextellar user id. */
  userId: string;
  provider: string;
  providerUserId: string;
  linkedAt: number;
}

// ---------------------------------------------------------------------------
// In-memory stores (swap for DB in production)
// ---------------------------------------------------------------------------

/** keyed by `${provider}:${providerUserId}` */
export const identityStore = new Map<string, IdentityRecord>();

/** keyed by userId */
export const userStore = new Map<string, NexitellarUser>();

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function identityKey(provider: string, providerUserId: string): string {
  return `${provider}:${providerUserId}`;
}

export interface FindOrCreateResult {
  user: NexitellarUser;
  /** True when a new Nextellar account was created during this call. */
  isNew: boolean;
}

/**
 * Find an existing Nextellar user linked to the given OAuth profile, or
 * create a new one and link it. Returns the user and whether it was newly
 * created.
 */
export function findOrCreateUser(
  profile: OAuthProfile,
  deps: {
    identityStore?: Map<string, IdentityRecord>;
    userStore?: Map<string, NexitellarUser>;
    now?: () => number;
    nextId?: () => string;
  } = {},
): FindOrCreateResult {
  const iStore = deps.identityStore ?? identityStore;
  const uStore = deps.userStore ?? userStore;
  const now = deps.now ?? (() => Date.now());
  const nextId = deps.nextId ?? (() => randomId('usr'));

  const key = identityKey(profile.provider, profile.providerUserId);
  const existing = iStore.get(key);

  if (existing) {
    const user = uStore.get(existing.userId);
    if (!user) {
      // Identity record exists but user was deleted — treat as new.
      uStore.delete(existing.userId);
      iStore.delete(key);
    } else {
      return { user, isNew: false };
    }
  }

  // Create a new user and link the identity.
  const userId = nextId();
  const user: NexitellarUser = {
    id: userId,
    email: profile.email,
    displayName: profile.displayName,
    createdAt: now(),
  };
  const identity: IdentityRecord = {
    userId,
    provider: profile.provider,
    providerUserId: profile.providerUserId,
    linkedAt: now(),
  };

  uStore.set(userId, user);
  iStore.set(key, identity);

  return { user, isNew: true };
}
