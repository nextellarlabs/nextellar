import { randomBytes } from 'crypto';

/**
 * Issuance, rotation, and revocation of refresh tokens.
 *
 * Why a chain?
 * Each refresh token is part of a *family* — every successful rotation
 * issues a new token and marks the old one as rotated. If a rotated
 * token is ever presented again it almost certainly means the token
 * was stolen and replayed by an attacker after the legitimate user
 * had already rotated. The entire family is revoked on detection,
 * limiting the blast radius of the theft to whatever the attacker
 * managed to do before the legitimate user next refreshed.
 *
 * This module is deliberately self-contained and in-memory: it is
 * meant to be wired in front of any concrete persistence layer (Redis,
 * Postgres, …) by replacing the storage callbacks below. Tests run
 * against the in-memory store directly.
 */

export type TokenState = 'active' | 'rotated' | 'revoked';

export interface TokenRecord {
  token: string;
  /** Stable identifier shared by every token in the rotation chain. */
  familyId: string;
  /** The end user this chain belongs to. */
  userId: string;
  state: TokenState;
  issuedAt: number;
  expiresAt: number;
  /** Filled in once the token is rotated; points at the successor token. */
  rotatedTo?: string;
}

export interface IssueResult {
  token: string;
  familyId: string;
  expiresAt: number;
}

export interface RotateSuccess {
  ok: true;
  result: IssueResult;
}

export interface RotateFailure {
  ok: false;
  reason: 'unknown' | 'expired' | 'revoked' | 'reuse_detected';
}

export type RotateResult = RotateSuccess | RotateFailure;

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function generateFamilyId(): string {
  return randomBytes(16).toString('base64url');
}

export class RefreshTokenStore {
  private readonly tokens = new Map<string, TokenRecord>();

  constructor(
    private readonly ttlSeconds: number = DEFAULT_TTL_SECONDS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Issue a brand new refresh token for `userId`, starting a fresh family. */
  issue(userId: string): IssueResult {
    const familyId = generateFamilyId();
    return this.persist(userId, familyId);
  }

  /**
   * Rotate `presented`: mark it as rotated and return a fresh token
   * in the same family.
   *
   * Reuse detection: if the presented token is *already* rotated, the
   * entire family is revoked and the call fails with `reuse_detected`.
   * Any subsequent rotation in that family will fail with `revoked`.
   */
  rotate(presented: string): RotateResult {
    const record = this.tokens.get(presented);

    if (!record) return { ok: false, reason: 'unknown' };

    if (record.state === 'revoked') {
      return { ok: false, reason: 'revoked' };
    }

    if (record.state === 'rotated') {
      this.revokeFamily(record.familyId);
      return { ok: false, reason: 'reuse_detected' };
    }

    if (record.expiresAt <= this.now()) {
      record.state = 'revoked';
      return { ok: false, reason: 'expired' };
    }

    const successor = this.persist(record.userId, record.familyId);
    record.state = 'rotated';
    record.rotatedTo = successor.token;
    return { ok: true, result: successor };
  }

  /** Revoke a single token. Idempotent. */
  revoke(token: string): void {
    const record = this.tokens.get(token);
    if (record && record.state !== 'revoked') record.state = 'revoked';
  }

  /** Revoke every token in a family. Idempotent. */
  revokeFamily(familyId: string): void {
    for (const record of this.tokens.values()) {
      if (record.familyId === familyId && record.state !== 'revoked') {
        record.state = 'revoked';
      }
    }
  }

  /** Read-only lookup used by tests; returns the stored record verbatim. */
  inspect(token: string): TokenRecord | undefined {
    return this.tokens.get(token);
  }

  /** Drop every record. Test-only. */
  clear(): void {
    this.tokens.clear();
  }

  private persist(userId: string, familyId: string): IssueResult {
    const issuedAt = this.now();
    const expiresAt = issuedAt + this.ttlSeconds * 1000;
    const token = generateToken();
    this.tokens.set(token, {
      token,
      familyId,
      userId,
      state: 'active',
      issuedAt,
      expiresAt,
    });
    return { token, familyId, expiresAt };
  }
}

/** Process-wide store used by the refresh route. */
export const refreshTokenStore = new RefreshTokenStore();
