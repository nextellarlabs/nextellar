// Fake clock helper for deterministic time-based testing (Issue #311).
//
// Replaces Date and performance.now() with deterministic implementations
// to eliminate timing-based flake in auth tests.

export interface FakeClock {
  /** Current time in milliseconds since epoch */
  now(): number;
  /** Advance time by the given milliseconds */
  advance(ms: number): void;
  /** Set time to a specific value */
  setTime(ms: number): void;
  /** Reset to initial time */
  reset(): void;
  /** Install fake clock globally (replaces Date and performance.now) */
  install(): void;
  /** Restore original Date and performance.now */
  restore(): void;
}

/**
 * Create a fake clock for deterministic testing.
 *
 * @param initialTime Initial time in milliseconds (default: now)
 * @returns Fake clock instance
 *
 * @example
 * const clock = createFakeClock();
 * clock.install();
 * const token = issueToken({ expiresIn: 3600 });
 * clock.advance(1800000); // 30 minutes
 * expect(isTokenExpired(token)).toBe(false);
 * clock.restore();
 */
export function createFakeClock(initialTime?: number): FakeClock {
  const startTime = initialTime ?? Date.now();
  let currentTime = startTime;

  const originalDate = Date;
  const originalPerformanceNow = performance.now;
  const originalDateNow = Date.now;

  return {
    now(): number {
      return currentTime;
    },

    advance(ms: number): void {
      currentTime += ms;
    },

    setTime(ms: number): void {
      currentTime = ms;
    },

    reset(): void {
      currentTime = startTime;
    },

    install(): void {
      // Replace Date constructor
      const FakeDateConstructor = class extends Date {
        constructor(...args: unknown[]) {
          if (args.length === 0) {
            super(currentTime);
          } else {
            super(...args);
          }
        }
      };

      // Copy static methods
      Object.setPrototypeOf(FakeDateConstructor, originalDate);
      FakeDateConstructor.now = () => currentTime;
      FakeDateConstructor.parse = originalDate.parse;
      FakeDateConstructor.UTC = originalDate.UTC;

      // Replace global Date
      (globalThis as unknown as { Date: typeof Date }).Date = FakeDateConstructor as unknown as typeof Date;

      // Replace performance.now
      (globalThis.performance as unknown as { now: () => number }).now = () => currentTime;
    },

    restore(): void {
      (globalThis as unknown as { Date: typeof Date }).Date = originalDate;
      (globalThis.performance as unknown as { now: () => number }).now = originalPerformanceNow;
    },
  };
}

/**
 * Token factory helper for creating test tokens with deterministic expiry.
 *
 * @param options Token configuration
 * @returns Token object with payload and expiry
 *
 * @example
 * const clock = createFakeClock();
 * clock.install();
 * const token = createTestToken({ sub: 'user-123', expiresIn: 3600 });
 * expect(token.expiresAt).toBe(clock.now() + 3600000);
 * clock.restore();
 */
export interface TestTokenOptions {
  sub: string;
  scopes?: string[];
  expiresIn?: number; // seconds
  issuedAt?: number; // milliseconds (default: now)
}

export interface TestToken {
  payload: {
    sub: string;
    scopes?: string[];
    iat: number;
    exp: number;
  };
  expiresAt: number;
  isExpired(now?: number): boolean;
}

export function createTestToken(
  options: TestTokenOptions,
  clock?: FakeClock,
): TestToken {
  const now = clock?.now() ?? Date.now();
  const issuedAt = options.issuedAt ?? now;
  const expiresIn = (options.expiresIn ?? 3600) * 1000; // Convert to ms
  const expiresAt = issuedAt + expiresIn;

  const payload = {
    sub: options.sub,
    scopes: options.scopes,
    iat: Math.floor(issuedAt / 1000),
    exp: Math.floor(expiresAt / 1000),
  };

  return {
    payload,
    expiresAt,
    isExpired(checkTime?: number): boolean {
      const time = checkTime ?? (clock?.now() ?? Date.now());
      return time >= expiresAt;
    },
  };
}
