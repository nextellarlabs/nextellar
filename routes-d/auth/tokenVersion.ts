// Per-user token version counter (#262).
//
// On password change the user's token version is bumped, which lets the
// server reject any previously-issued token whose embedded `tv` claim is
// older than the current counter. The session that performed the password
// change can keep its current token because the rotation handler returns
// the new token version and the caller is expected to re-sign that
// session's JWT before the response goes out.

export interface TokenVersionRecord {
  userId: string;
  version: number;
  updatedAt: number;
}

export interface TokenVersionStoreOptions {
  now?: () => number;
}

export class TokenVersionStore {
  private readonly versions = new Map<string, TokenVersionRecord>();
  private readonly now: () => number;

  constructor(options: TokenVersionStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  current(userId: string): number {
    const id = this.normalize(userId);
    return this.versions.get(id)?.version ?? 0;
  }

  /**
   * Bump the user's token version. Returns the new version so the caller can
   * immediately re-sign the active session's token without forcing a logout.
   */
  bump(userId: string): TokenVersionRecord {
    const id = this.normalize(userId);
    const existing = this.versions.get(id);
    const next: TokenVersionRecord = {
      userId: id,
      version: (existing?.version ?? 0) + 1,
      updatedAt: this.now(),
    };
    this.versions.set(id, next);
    return next;
  }

  /**
   * Returns true when `tv` matches the current version for the user (or the
   * user has no recorded bumps yet, in which case the implicit version is 0).
   */
  isCurrent(userId: string, tv: number | undefined): boolean {
    if (tv === undefined || Number.isNaN(tv)) {
      return false;
    }
    return this.current(userId) === tv;
  }

  reset(): void {
    this.versions.clear();
  }

  private normalize(userId: string): string {
    if (typeof userId !== "string" || userId.trim() === "") {
      throw new Error("invalid_user_id");
    }
    return userId.trim();
  }
}

export const tokenVersionStore = new TokenVersionStore();
