/**
 * Client-side guard for the Horizon request budget.
 *
 * The default template talks to Horizon from two directions at once:
 *
 *  - `stream` — refreshes triggered by a live Horizon SSE event
 *    (see `useHorizonStreaming`).
 *  - `poll`   — refreshes triggered by a periodic poll
 *    (see `useStellarBalances` / `useTransactionHistory`).
 *
 * Both spend from the *same* budget, so a naive single counter lets one side
 * starve the other: a burst of stream events can consume every slot in the
 * window and leave the poller permanently blocked (and vice versa).
 *
 * The limiter therefore keeps two counters and a per-class reservation:
 *
 *  - every request is counted exactly once, in the class that triggered it,
 *  - a class may never take the slots reserved for the other one, and
 *  - the total number of requests per window is still capped, so the app
 *    stays inside the budget Horizon enforces per IP.
 */

/**
 * Traffic class a Horizon request belongs to.
 *
 * `stream` is used for refreshes triggered by a live SSE event, `poll` for
 * everything scheduled (initial load, periodic polls, pagination).
 */
export type HorizonTrafficClass = 'stream' | 'poll';

/** Every traffic class the limiter knows about. */
export const HORIZON_TRAFFIC_CLASSES: HorizonTrafficClass[] = ['stream', 'poll'];

/** Class used when a caller does not specify one. */
export const DEFAULT_TRAFFIC_CLASS: HorizonTrafficClass = 'poll';

export interface HorizonRateLimiterOptions {
  /** Maximum number of requests allowed inside one window (all classes). */
  maxRequestsPerWindow?: number;
  /** Length of the rolling window in milliseconds. */
  windowMs?: number;
  /** Cooldown applied when a request fails with HTTP 429. */
  defaultBackoffMs?: number;
  /**
   * Slots held back for the *other* traffic class while both classes are
   * active. With a budget of 30 requests per 10s window and a reservation of
   * 10, either class can always spend 10 slots per window no matter how hard
   * the other one pushes — that is the guarantee that keeps a burst of live
   * updates from starving the poller (and the other way round).
   *
   * The reservation only applies while the other class is actually spending
   * from the window: an app that only polls keeps the full budget.
   */
  reservedRequestsPerClass?: number;
}

/**
 * Error thrown when the client-side guard blocks a request before it is sent.
 *
 * It is a *local* throttle, not a Horizon failure, so callers can treat it
 * differently from a genuine request error (skip the tick instead of
 * surfacing an error to the user).
 */
export class HorizonRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HorizonRateLimitError';
  }
}

export class HorizonRateLimiter {
  private requests: number[] = [];
  private requestsByClass: Record<HorizonTrafficClass, number[]> = {
    stream: [],
    poll: [],
  };
  private maxRequests: number;
  private windowMs: number;
  private defaultBackoffMs: number;
  private reservedRequestsPerClass: number;
  private rateLimitedUntil: number = 0;

  constructor(options: HorizonRateLimiterOptions = {}) {
    this.maxRequests = Math.max(1, options.maxRequestsPerWindow ?? 30);
    this.windowMs = Math.max(1, options.windowMs ?? 10_000);
    this.defaultBackoffMs = Math.max(0, options.defaultBackoffMs ?? 5_000);
    // A reservation must leave at least one slot per class, otherwise the
    // class it protects could never make a request at all.
    this.reservedRequestsPerClass = Math.min(
      Math.max(0, options.reservedRequestsPerClass ?? 0),
      Math.max(0, this.maxRequests - 1),
    );
  }

  /**
   * Whether a request would currently be blocked.
   *
   * Without a traffic class the total number of requests in the window is
   * checked. With one, the class is additionally checked against its own cap
   * so it cannot spend the slots reserved for the other class.
   */
  public isRateLimited(trafficClass?: HorizonTrafficClass): boolean {
    const now = Date.now();
    if (now < this.rateLimitedUntil) {
      return true;
    }
    this.cleanWindow(now);
    if (!trafficClass) {
      return this.requests.length >= this.maxRequests;
    }
    return !this.canAdmit(trafficClass);
  }

  public getRemainingCooldownMs(): number {
    const now = Date.now();
    if (now < this.rateLimitedUntil) {
      return this.rateLimitedUntil - now;
    }
    return 0;
  }

  public record429(retryAfterSeconds?: number): void {
    const backoffMs = retryAfterSeconds
      ? retryAfterSeconds * 1000
      : this.defaultBackoffMs;
    this.rateLimitedUntil = Date.now() + backoffMs;
  }

  public reset(): void {
    this.requests = [];
    this.requestsByClass = { stream: [], poll: [] };
    this.rateLimitedUntil = 0;
  }

  /** Total budget of one window, shared by every traffic class. */
  public getMaxRequestsPerWindow(): number {
    return this.maxRequests;
  }

  /** Slots reserved for the other traffic class while both are active. */
  public getReservedRequestsPerClass(): number {
    return this.reservedRequestsPerClass;
  }

  /**
   * Number of requests recorded inside the current window.
   *
   * Used by tests to prove that a request is counted exactly once even when
   * the streaming hook and a polling hook are active at the same time.
   */
  public getRequestCount(trafficClass?: HorizonTrafficClass): number {
    this.cleanWindow(Date.now());
    if (trafficClass) {
      return this.requestsByClass[trafficClass].length;
    }
    return this.requests.length;
  }

  /**
   * Cap currently applied to `trafficClass`.
   *
   * While the other class is idle the class may use the whole window; as soon
   * as the other class spends from the window, the reservation kicks in.
   */
  public getTrafficClassLimit(trafficClass: HorizonTrafficClass): number {
    const otherRequests =
      this.requests.length - this.requestsByClass[trafficClass].length;
    if (otherRequests <= 0) {
      return this.maxRequests;
    }
    return Math.max(this.maxRequests - this.reservedRequestsPerClass, 1);
  }

  private cleanWindow(now: number): void {
    const cutoff = now - this.windowMs;
    this.requests = this.requests.filter((timestamp) => timestamp > cutoff);
    for (const trafficClass of HORIZON_TRAFFIC_CLASSES) {
      this.requestsByClass[trafficClass] = this.requestsByClass[
        trafficClass
      ].filter((timestamp) => timestamp > cutoff);
    }
  }

  private canAdmit(trafficClass: HorizonTrafficClass): boolean {
    // The window as a whole is exhausted — nobody may send another request.
    if (this.requests.length >= this.maxRequests) {
      return false;
    }
    // The class may not spend the slots reserved for the other class.
    return (
      this.requestsByClass[trafficClass].length <
      this.getTrafficClassLimit(trafficClass)
    );
  }

  private record(trafficClass: HorizonTrafficClass): void {
    const now = Date.now();
    this.requests.push(now);
    this.requestsByClass[trafficClass].push(now);
  }

  /**
   * Run `fn` unless the shared budget is exhausted.
   *
   * The request is counted exactly once, in `trafficClass`, and a HTTP 429
   * puts *every* class into cooldown — the server is throttling the app as a
   * whole, so all callers must back off together.
   */
  public async execute<T>(
    fn: () => Promise<T>,
    trafficClass: HorizonTrafficClass = DEFAULT_TRAFFIC_CLASS,
  ): Promise<T> {
    if (this.isRateLimited(trafficClass)) {
      const remaining = this.getRemainingCooldownMs() || 1000;
      throw new HorizonRateLimitError(
        `Client rate-limit guard active. Please wait ${Math.ceil(
          remaining / 1000,
        )}s before retrying.`,
      );
    }

    this.record(trafficClass);

    try {
      return await fn();
    } catch (error: unknown) {
      if (error?.response?.status === 429 || error?.status === 429) {
        const retryAfterHeader = error?.response?.headers?.get?.('Retry-After');
        const retryAfterSec = retryAfterHeader
          ? parseInt(retryAfterHeader, 10)
          : undefined;
        this.record429(retryAfterSec);
      }
      throw error;
    }
  }
}

/**
 * Shared guard for every Horizon request the default template makes.
 *
 * The SSE stream and the polling hooks spend from this one budget, so the
 * fair-share rule above keeps either side alive when both are active.
 */
export const globalHorizonRateLimiter = new HorizonRateLimiter({
  maxRequestsPerWindow: 30,
  windowMs: 10_000,
  defaultBackoffMs: 5_000,
  reservedRequestsPerClass: 10,
});
