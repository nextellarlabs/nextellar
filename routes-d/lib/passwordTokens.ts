import { randomBytes } from 'crypto';

/**
 * Single-use, short-lived tokens used by the password reset flow.
 *
 * Tokens:
 *   - are opaque, 32-byte random strings (base64url-encoded);
 *   - expire 30 minutes after issuance (Issue #257 requirement);
 *   - can be consumed exactly once — a successful confirmation
 *     marks the token as used so a leaked link cannot be replayed.
 *
 * Storage is in-memory by design so the routes module has no hard
 * dependency on a particular database. Production deployments are
 * expected to swap this for a Redis/Postgres-backed implementation
 * that exposes the same surface.
 */

export interface PasswordTokenRecord {
  token: string;
  email: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
  used: boolean;
}

export type ConsumeResult =
  | { ok: true; record: PasswordTokenRecord }
  | { ok: false; reason: 'unknown' | 'used' | 'expired' };

export const PASSWORD_TOKEN_TTL_MS = 30 * 60 * 1000;

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export class PasswordTokenStore {
  private readonly tokens = new Map<string, PasswordTokenRecord>();

  constructor(
    private readonly ttlMs: number = PASSWORD_TOKEN_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Create a fresh reset token for `email`. Any prior unused token for
   * the same email is invalidated so a stale link can't be used after
   * the user has requested a new one.
   */
  create(email: string, userId: string): PasswordTokenRecord {
    this.invalidateActiveTokens(email);

    const issuedAt = this.now();
    const record: PasswordTokenRecord = {
      token: generateToken(),
      email,
      userId,
      issuedAt,
      expiresAt: issuedAt + this.ttlMs,
      used: false,
    };
    this.tokens.set(record.token, record);
    return record;
  }

  /**
   * Atomically consume a token. After a successful call the token is
   * permanently marked as used and cannot be presented again — even by
   * the same caller.
   */
  consume(token: string): ConsumeResult {
    const record = this.tokens.get(token);
    if (!record) return { ok: false, reason: 'unknown' };
    if (record.used) return { ok: false, reason: 'used' };
    if (record.expiresAt <= this.now()) return { ok: false, reason: 'expired' };
    record.used = true;
    return { ok: true, record };
  }

  /** Read-only lookup used in tests. */
  inspect(token: string): PasswordTokenRecord | undefined {
    return this.tokens.get(token);
  }

  /** Test helper. */
  clear(): void {
    this.tokens.clear();
  }

  private invalidateActiveTokens(email: string): void {
    for (const record of this.tokens.values()) {
      if (record.email === email && !record.used) {
        record.used = true;
      }
    }
  }
}

/** Process-wide store wired into the password reset routes. */
export const passwordTokenStore = new PasswordTokenStore();
