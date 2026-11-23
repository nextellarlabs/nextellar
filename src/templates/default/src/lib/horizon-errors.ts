/**
 * Shared classification of Horizon failures.
 *
 * Every hook that talks to Horizon used to parse `err.response.status` /
 * `result_codes` on its own, which produced inconsistent messages. This module
 * is the single place that turns "whatever was thrown" into a typed
 * {@link HorizonError} with a stable `kind` and a user-facing message.
 *
 * It understands the error shapes the Stellar SDK / axios produce
 * (`err.response.status`, `err.response.data.extras.result_codes`,
 * `name === 'NotFoundError'`) as well as plain `fetch` failures (`err.status`,
 * `TypeError: Failed to fetch`).
 */

import { decodeResultCodes } from './stellarResultCodes';

/** What went wrong, independent of how a given hook words it. */
export type HorizonErrorKind =
  /** Horizon rejected a submitted transaction and returned `result_codes`. */
  | 'transaction_failed'
  /** HTTP 400 without result codes. */
  | 'bad_request'
  /** HTTP 404 (e.g. an unfunded account) or an SDK `NotFoundError`. */
  | 'not_found'
  /** HTTP 429. See `retryAfterSeconds` when Horizon supplied `Retry-After`. */
  | 'rate_limited'
  /** HTTP 5xx. */
  | 'server_error'
  /** Any other HTTP 4xx. */
  | 'client_error'
  /** No HTTP response at all: offline, DNS failure, timeout, CORS, etc. */
  | 'network'
  /** Not recognisably a Horizon failure (validation errors, programmer errors). */
  | 'unknown';

/**
 * Which kind of call failed. Hooks historically word the same failure
 * differently per call type, and those messages are part of their observable
 * behaviour, so the context selects the wording while `kind` stays constant.
 */
export type HorizonErrorContext = 'read' | 'build' | 'submit';

export interface HorizonResultCodes {
  transaction?: string;
  operations?: string[];
}

export interface ClassifyHorizonErrorOptions {
  /** Defaults to `'read'`. */
  context?: HorizonErrorContext;
  /** Account named in the "not found" message for `'build'` failures. */
  accountId?: string;
  /** Message used when the thrown value carries none of its own. */
  fallbackMessage?: string;
}

export class HorizonError extends Error {
  readonly kind: HorizonErrorKind;
  /** HTTP status, when Horizon (or fetch) produced one. */
  readonly status?: number;
  /** Transaction/operation result codes for `transaction_failed`. */
  readonly resultCodes?: HorizonResultCodes;
  /** Seconds from the `Retry-After` header on a 429, when present. */
  readonly retryAfterSeconds?: number;
  /** Raw response body (`response.data`), when present. */
  readonly raw?: unknown;
  /** The value that was originally thrown. */
  readonly originalError: unknown;
  /** User-facing message; identical to `message`. */
  readonly userMessage: string;

  constructor(
    kind: HorizonErrorKind,
    userMessage: string,
    details: {
      status?: number;
      resultCodes?: HorizonResultCodes;
      retryAfterSeconds?: number;
      raw?: unknown;
      originalError?: unknown;
    } = {},
  ) {
    super(userMessage);
    this.name = 'HorizonError';
    this.kind = kind;
    this.userMessage = userMessage;
    this.status = details.status;
    this.resultCodes = details.resultCodes;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.raw = details.raw;
    this.originalError = details.originalError;
  }
}

/** Loose view of the shapes Horizon clients throw. */
interface ErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  response?: {
    status?: unknown;
    data?: unknown;
    headers?: unknown;
  };
}

const NETWORK_ERROR_CODES = new Set([
  'ERR_NETWORK',
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

function asErrorLike(err: unknown): ErrorLike {
  return err && typeof err === 'object' ? (err as ErrorLike) : {};
}

function readStatus(e: ErrorLike): number | undefined {
  const candidates = [e.response?.status, e.status, e.statusCode];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function readResultCodes(e: ErrorLike): HorizonResultCodes | undefined {
  const data = e.response?.data as
    | { extras?: { result_codes?: HorizonResultCodes } }
    | undefined;
  const codes = data?.extras?.result_codes;
  return codes && typeof codes === 'object' ? codes : undefined;
}

function readRetryAfterSeconds(e: ErrorLike): number | undefined {
  const headers = e.response?.headers as
    | { get?: (name: string) => unknown; [key: string]: unknown }
    | undefined;
  if (!headers || typeof headers !== 'object') return undefined;
  const raw =
    typeof headers.get === 'function'
      ? headers.get('retry-after')
      : (headers['retry-after'] ?? headers['Retry-After']);
  const seconds = typeof raw === 'string' ? Number(raw) : raw;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? seconds
    : undefined;
}

function isNetworkFailure(e: ErrorLike, message: string): boolean {
  if (typeof e.code === 'string' && NETWORK_ERROR_CODES.has(e.code)) return true;
  // 'fetch' covers "Failed to fetch" (browsers) and "fetch failed" (undici).
  return /fetch|network ?error|timed? ?out/i.test(message);
}

function messageFor(
  kind: HorizonErrorKind,
  context: HorizonErrorContext,
  detail: string,
  status: number | undefined,
  resultCodes: HorizonResultCodes | undefined,
  retryAfterSeconds: number | undefined,
  options: ClassifyHorizonErrorOptions,
): string {
  switch (kind) {
    case 'transaction_failed':
      return decodeResultCodes(resultCodes).reason;

    case 'rate_limited':
      return retryAfterSeconds
        ? `Horizon rate limit reached (HTTP 429). Please wait ${retryAfterSeconds}s and try again.`
        : 'Horizon rate limit reached (HTTP 429). Please wait a moment and try again.';

    case 'not_found':
      if (context === 'build') {
        return options.accountId
          ? `Account ${options.accountId} not found. Account may need funding.`
          : 'Account not found. Account may need funding.';
      }
      return 'The requested account or resource was not found on Horizon.';

    case 'server_error':
      if (context === 'submit') return 'Horizon server error during submission';
      if (context === 'build') {
        return `Horizon server error: ${detail || 'Network unavailable'}`;
      }
      return `Network error: ${detail || 'Failed to connect to Horizon'}`;

    case 'bad_request':
    case 'client_error':
      if (context === 'submit') {
        return kind === 'bad_request'
          ? 'Invalid transaction format or content'
          : detail || `Horizon rejected the request (Status: ${status})`;
      }
      if (context === 'build') {
        return `Invalid request: ${detail || 'Bad request to Horizon'}`;
      }
      return `Client error: ${detail || 'Invalid request to Horizon'} (Status: ${status})`;

    case 'network':
      return `Network error: ${detail || 'Failed to connect to Horizon'}`;

    case 'unknown':
    default:
      return detail || options.fallbackMessage || 'Unknown error communicating with Horizon';
  }
}

/**
 * Classify anything thrown while talking to Horizon.
 *
 * Never throws and always returns a {@link HorizonError}. Passing an existing
 * `HorizonError` returns it unchanged. Values that are not recognisably a
 * Horizon failure come back with `kind: 'unknown'`; hooks should rethrow the
 * original error in that case (see {@link toThrowableHorizonError}).
 */
export function classifyHorizonError(
  err: unknown,
  options: ClassifyHorizonErrorOptions = {},
): HorizonError {
  if (err instanceof HorizonError) return err;

  const context = options.context ?? 'read';
  const e = asErrorLike(err);
  const status = readStatus(e);
  const resultCodes = readResultCodes(e);
  const detail = typeof e.message === 'string' ? e.message : '';
  const retryAfterSeconds = readRetryAfterSeconds(e);

  let kind: HorizonErrorKind;
  if (resultCodes) kind = 'transaction_failed';
  else if (status === 429) kind = 'rate_limited';
  else if (status === 404 || e.name === 'NotFoundError') kind = 'not_found';
  else if (status !== undefined && status >= 500) kind = 'server_error';
  else if (status === 400) kind = 'bad_request';
  else if (status !== undefined && status >= 400 && status < 500) kind = 'client_error';
  else if (status === undefined && isNetworkFailure(e, detail)) kind = 'network';
  else kind = 'unknown';

  return new HorizonError(
    kind,
    messageFor(kind, context, detail, status, resultCodes, retryAfterSeconds, options),
    {
      status,
      resultCodes,
      retryAfterSeconds: kind === 'rate_limited' ? retryAfterSeconds : undefined,
      raw: e.response?.data,
      originalError: err,
    },
  );
}

/**
 * What a hook should `throw` after classifying a failure: the typed
 * {@link HorizonError} for recognised Horizon failures, or the original error
 * (wrapped in an `Error` if it was not one) when it is not a Horizon failure,
 * so validation errors keep their identity and wording.
 */
export function toThrowableHorizonError(
  err: unknown,
  classified: HorizonError,
  fallbackMessage: string,
): Error {
  if (classified.kind !== 'unknown') return classified;
  return err instanceof Error ? err : new Error(fallbackMessage);
}
