import {
  globalHorizonRateLimiter,
  type HorizonRateLimiter,
} from './horizonRateLimiter';

export interface HorizonFetchOptions {
  /** Retries after the first attempt. Default: 3 (so up to 4 requests). */
  maxRetries?: number;
  /** Base delay for exponential backoff. Default: 500ms. */
  baseDelayMs?: number;
  /** Upper bound for the computed backoff delay. Default: 10_000ms. */
  maxDelayMs?: number;
  /**
   * If a server-provided `Retry-After` exceeds this, stop retrying and hand
   * back the response instead of waiting. Default: 60_000ms.
   */
  maxRetryAfterMs?: number;
  /** Client-side rate limiter to go through. Default: the shared global one. */
  rateLimiter?: HorizonRateLimiter;
  /** Injectable for tests. Default: `Math.random`. */
  random?: () => number;
  /** Injectable for tests. Default: `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

/** Statuses worth retrying: rate limited or transient upstream failures. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/** Only idempotent, side-effect-free methods are retried. */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD']);

/**
 * Thrown inside the rate-limiter callback so the limiter can see the status
 * and `Retry-After` header and enter its 429 cooldown.
 */
class RetryableHttpError extends Error {
  readonly status: number;
  readonly response: Response;
  constructor(response: Response) {
    super(`Horizon error ${response.status}`);
    this.status = response.status;
    this.response = response;
  }
}

/** Parses `Retry-After` (delay-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfterMs(
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

function abortError(signal?: AbortSignal | null): unknown {
  return (
    signal?.reason ??
    Object.assign(new Error('The operation was aborted.'), {
      name: 'AbortError',
    })
  );
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * `fetch` for Horizon GETs with exponential backoff + full jitter.
 *
 * - Retries network errors and 429/502/503/504, only for GET/HEAD.
 * - Waits at least as long as `Retry-After` and the rate limiter's cooldown.
 * - Every attempt goes through the rate limiter; when it is in cooldown or
 *   over budget the attempt is skipped (no request sent) and waited out.
 * - Honors `init.signal`: no further attempts once aborted, and waits are
 *   cancelled immediately.
 * - Mirrors `fetch`: once retries are exhausted the last retryable `Response`
 *   is returned (callers keep checking `res.ok`); network errors are thrown.
 */
export async function horizonFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: HorizonFetchOptions = {},
): Promise<Response> {
  const {
    maxRetries = 3,
    baseDelayMs = 500,
    maxDelayMs = 10_000,
    maxRetryAfterMs = 60_000,
    rateLimiter = globalHorizonRateLimiter,
    random = Math.random,
    fetchImpl,
  } = options;

  const doFetch = fetchImpl ?? globalThis.fetch;
  const signal = init?.signal;
  const method = (
    init?.method ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase();
  const retries = IDEMPOTENT_METHODS.has(method) ? maxRetries : 0;

  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw abortError(signal);

    let response: Response | undefined;
    let failure: unknown;
    let skippedByLimiter = false;

    if (rateLimiter.isRateLimited()) {
      skippedByLimiter = true;
    } else {
      try {
        response = await rateLimiter.execute(async () => {
          const res = await doFetch(input, init);
          if (RETRYABLE_STATUSES.has(res.status)) {
            throw new RetryableHttpError(res);
          }
          return res;
        });
      } catch (err) {
        if (err instanceof RetryableHttpError) {
          response = err.response;
        } else {
          failure = err;
        }
      }
    }

    // Success, or a status we never retry (e.g. 404): behave like fetch.
    if (response && !RETRYABLE_STATUSES.has(response.status)) return response;

    // A caller abort is final, never retried.
    if (signal?.aborted) throw abortError(signal);

    const attemptsLeft = attempt < retries;
    if (!attemptsLeft) {
      if (response) return response;
      if (skippedByLimiter) {
        const secs = Math.ceil(
          (rateLimiter.getRemainingCooldownMs() || 1000) / 1000,
        );
        throw new Error(
          `Client rate-limit guard active. Please wait ${secs}s before retrying.`,
        );
      }
      throw failure;
    }

    const backoff = random() * Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    const retryAfter = parseRetryAfterMs(response?.headers?.get('Retry-After'));
    if (retryAfter !== undefined && retryAfter > maxRetryAfterMs && response) {
      return response;
    }
    const delay = Math.max(
      backoff,
      retryAfter ?? 0,
      rateLimiter.getRemainingCooldownMs(),
    );
    await sleep(delay, signal);
  }
}
