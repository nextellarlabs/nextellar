/**
 * Retry Engine
 *
 * Generic retry mechanism with exponential backoff, configurable
 * max retries, retryable error detection, and terminal failure handling.
 *
 * Used by the email dispatcher to retry failed provider sends.
 */

// --- Custom error types ---

/** Error that should be retried (transient failure) */
export class RetryableError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'RetryableError';
  }
}

/** Error that should NOT be retried (permanent failure) */
export class TerminalError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'TerminalError';
  }
}

/** Max retries reached — the operation has been abandoned */
export class RetryLimitExceededError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: unknown
  ) {
    super(message);
    this.name = 'RetryLimitExceededError';
  }
}

// --- Configuration ---

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay between retries in ms (default: 100) */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (default: 30000) */
  maxDelayMs?: number;
  /** Jitter factor (0-1) to add randomness, default 0.1 */
  jitterFactor?: number;
  /**
   * Predicate that determines whether an error is retryable.
   * Default: retry everything except TerminalError.
   */
  isRetryable?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'isRetryable'>> = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 30000,
  jitterFactor: 0.1,
};

// --- Core retry function ---

/**
 * Execute `fn` with automatic retries on failure.
 *
 * - Waits with exponential backoff between attempts.
 * - Adds random jitter to prevent thundering herd.
 * - Respects the `isRetryable` predicate to skip non-retryable errors.
 * - Throws `RetryLimitExceededError` after exhausting all retries.
 *
 * @param fn      The async operation to retry.
 * @param options Retry configuration.
 * @returns The resolved value of `fn`.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const maxRetries = opts.maxRetries;
  const isRetryable =
    options.isRetryable ??
    defaultIsRetryable;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      // Check if this error is terminal (don't retry)
      if (!isRetryable(error)) {
        throw error instanceof TerminalError
          ? error
          : new TerminalError(
              `Non-retryable error after ${attempt + 1} attempt(s)`,
              error instanceof Error ? error : undefined
            );
      }

      // Ran out of retries
      if (attempt === maxRetries) {
        throw new RetryLimitExceededError(
          `Operation failed after ${maxRetries + 1} attempts (${maxRetries} retries)`,
          maxRetries + 1,
          lastError
        );
      }

      // Exponential backoff with jitter
      const delay = computeDelay(attempt, opts);
      await sleep(delay);
    }
  }

  // Should be unreachable; satisfy TypeScript
  throw new RetryLimitExceededError(
    `Operation failed unexpectedly`,
    maxRetries + 1,
    lastError!
  );
}

// --- Helpers ---

function defaultIsRetryable(error: unknown): boolean {
  // TerminalError signals a permanent failure — never retry these
  if (error instanceof TerminalError) return false;
  // Everything else is potentially transient
  return true;
}

function computeDelay(
  attempt: number,
  opts: Required<Omit<RetryOptions, 'isRetryable'>>
): number {
  // Exponential: baseDelay * 2^attempt
  const exponential = opts.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, opts.maxDelayMs);

  // Jitter: ± jitterFactor * capped
  const jitterRange = capped * opts.jitterFactor;
  const jitter = Math.random() * jitterRange * 2 - jitterRange;

  return Math.round(capped + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
