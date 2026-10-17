export interface HorizonRateLimiterOptions {
  maxRequestsPerWindow?: number;
  windowMs?: number;
  defaultBackoffMs?: number;
}

export class HorizonRateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private windowMs: number;
  private defaultBackoffMs: number;
  private rateLimitedUntil: number = 0;

  constructor(options: HorizonRateLimiterOptions = {}) {
    this.maxRequests = options.maxRequestsPerWindow ?? 30;
    this.windowMs = options.windowMs ?? 10_000;
    this.defaultBackoffMs = options.defaultBackoffMs ?? 5_000;
  }

  public isRateLimited(): boolean {
    const now = Date.now();
    if (now < this.rateLimitedUntil) {
      return true;
    }
    this.cleanWindow(now);
    return this.requests.length >= this.maxRequests;
  }

  public getRemainingCooldownMs(): number {
    const now = Date.now();
    if (now < this.rateLimitedUntil) {
      return this.rateLimitedUntil - now;
    }
    return 0;
  }

  public record429(retryAfterSeconds?: number): void {
    const backoffMs = retryAfterSeconds ? retryAfterSeconds * 1000 : this.defaultBackoffMs;
    this.rateLimitedUntil = Date.now() + backoffMs;
  }

  public reset(): void {
    this.requests = [];
    this.rateLimitedUntil = 0;
  }

  private cleanWindow(now: number): void {
    const cutoff = now - this.windowMs;
    this.requests = this.requests.filter((timestamp) => timestamp > cutoff);
  }

  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isRateLimited()) {
      const remaining = this.getRemainingCooldownMs() || 1000;
      throw new Error(`Client rate-limit guard active. Please wait ${Math.ceil(remaining / 1000)}s before retrying.`);
    }

    this.requests.push(Date.now());

    try {
      return await fn();
    } catch (error: any) {
      if (error?.response?.status === 429 || error?.status === 429) {
        const retryAfterHeader = error?.response?.headers?.get?.('Retry-After');
        const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
        this.record429(retryAfterSec);
      }
      throw error;
    }
  }
}

export const globalHorizonRateLimiter = new HorizonRateLimiter();
