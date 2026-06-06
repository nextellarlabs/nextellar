// Per-tier payment limit enforcement (#292).
//
// Tracks per-user daily totals and per-transaction caps keyed by
// account tier. Windows reset on a configurable schedule (default 24 h).
// Callers that exceed either limit receive a 403-level rejection.

export type AccountTier = "free" | "basic" | "pro" | "enterprise";

export interface TierLimits {
  /** Maximum single-transaction amount (inclusive). */
  maxPerTransaction: number;
  /** Maximum cumulative daily amount (inclusive). */
  maxDailyTotal: number;
}

/** Default tier thresholds. Override via PaymentLimitsOptions.tiers. */
export const DEFAULT_TIER_LIMITS: Readonly<Record<AccountTier, TierLimits>> = {
  free:       { maxPerTransaction: 100,    maxDailyTotal: 200    },
  basic:      { maxPerTransaction: 1_000,  maxDailyTotal: 5_000  },
  pro:        { maxPerTransaction: 10_000, maxDailyTotal: 50_000 },
  enterprise: { maxPerTransaction: Infinity, maxDailyTotal: Infinity },
};

export interface LimitCheckResult {
  allowed: boolean;
  /** Human-readable reason when allowed === false. */
  reason?: string;
}

export interface DailyUsage {
  total: number;
  /** Start of the current window (epoch ms). */
  windowStart: number;
}

export interface PaymentLimitsStore {
  getUsage(userId: string): Promise<DailyUsage | undefined>;
  setUsage(userId: string, usage: DailyUsage): Promise<void>;
}

export interface PaymentLimitsOptions {
  store: PaymentLimitsStore;
  tiers?: Partial<Record<AccountTier, TierLimits>>;
  /** Window duration in ms. Defaults to 24 h. */
  windowMs?: number;
  now?: () => number;
}

export class InMemoryPaymentLimitsStore implements PaymentLimitsStore {
  private readonly data = new Map<string, DailyUsage>();

  async getUsage(userId: string): Promise<DailyUsage | undefined> {
    return this.data.get(userId);
  }

  async setUsage(userId: string, usage: DailyUsage): Promise<void> {
    this.data.set(userId, usage);
  }

  /** Wipe all usage records (useful in tests). */
  clear(): void {
    this.data.clear();
  }
}

const DAY_MS = 86_400_000;

export class PaymentLimitsService {
  private readonly store: PaymentLimitsStore;
  private readonly tiers: Readonly<Record<AccountTier, TierLimits>>;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(opts: PaymentLimitsOptions) {
    this.store = opts.store;
    this.tiers = {
      ...DEFAULT_TIER_LIMITS,
      ...(opts.tiers ?? {}),
    };
    this.windowMs = opts.windowMs ?? DAY_MS;
    this.now = opts.now ?? Date.now;
  }

  private limitsFor(tier: AccountTier): TierLimits {
    return this.tiers[tier] ?? this.tiers.free;
  }

  /**
   * Check whether a payment of `amount` is allowed for `userId` at `tier`.
   * Does NOT record the usage — call `recordPayment` after a successful check.
   */
  async check(
    userId: string,
    tier: AccountTier,
    amount: number,
  ): Promise<LimitCheckResult> {
    const limits = this.limitsFor(tier);

    if (amount <= 0 || !Number.isFinite(amount)) {
      return { allowed: false, reason: "amount must be a positive finite number" };
    }

    if (amount > limits.maxPerTransaction) {
      return {
        allowed: false,
        reason: `amount ${amount} exceeds per-transaction limit of ${limits.maxPerTransaction} for tier "${tier}"`,
      };
    }

    const usage = await this.currentUsage(userId);
    const projected = usage.total + amount;

    if (projected > limits.maxDailyTotal) {
      return {
        allowed: false,
        reason: `daily total would reach ${projected}, exceeding limit of ${limits.maxDailyTotal} for tier "${tier}"`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a completed payment. Call this only after `check` returns allowed.
   */
  async recordPayment(userId: string, amount: number): Promise<void> {
    const usage = await this.currentUsage(userId);
    await this.store.setUsage(userId, {
      total: usage.total + amount,
      windowStart: usage.windowStart,
    });
  }

  /**
   * Reset the daily window for a specific user.
   * Useful for scheduled resets or manual overrides.
   */
  async resetWindow(userId: string): Promise<void> {
    await this.store.setUsage(userId, { total: 0, windowStart: this.now() });
  }

  /**
   * Reset all users whose window has expired.
   * Wire this into a scheduler (e.g. registerJob) to run periodically.
   */
  async resetExpiredWindows(userIds: string[]): Promise<void> {
    const now = this.now();
    for (const userId of userIds) {
      const usage = await this.store.getUsage(userId);
      if (usage && now - usage.windowStart >= this.windowMs) {
        await this.store.setUsage(userId, { total: 0, windowStart: now });
      }
    }
  }

  private async currentUsage(userId: string): Promise<DailyUsage> {
    const now = this.now();
    const stored = await this.store.getUsage(userId);
    if (!stored || now - stored.windowStart >= this.windowMs) {
      return { total: 0, windowStart: now };
    }
    return stored;
  }
}
