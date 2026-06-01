export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  halfOpenSuccessThreshold?: number;
}

export class CircuitOpenError extends Error {
  readonly state: CircuitState = "open";

  constructor(message = "circuit breaker is open") {
    super(message);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private halfOpenSuccesses = 0;
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenSuccessThreshold: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 5_000;
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 1;
  }

  getState(now = Date.now()): CircuitState {
    if (this.state === "open" && now - this.openedAt >= this.resetTimeoutMs) {
      this.state = "half-open";
      this.halfOpenSuccesses = 0;
    }
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>, now = Date.now()): Promise<T> {
    const state = this.getState(now);
    if (state === "open") {
      throw new CircuitOpenError();
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(now);
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === "half-open") {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.halfOpenSuccessThreshold) {
        this.state = "closed";
        this.consecutiveFailures = 0;
        this.halfOpenSuccesses = 0;
      }
      return;
    }

    this.state = "closed";
    this.consecutiveFailures = 0;
  }

  private onFailure(now: number): void {
    if (this.state === "half-open") {
      this.trip(now);
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.trip(now);
    }
  }

  private trip(now: number): void {
    this.state = "open";
    this.openedAt = now;
    this.consecutiveFailures = 0;
    this.halfOpenSuccesses = 0;
  }
}
