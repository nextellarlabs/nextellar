/**
 * API key resolution and validation helper.
 *
 * Extracts the raw API key from an Express request using a priority chain:
 *   1. `Authorization: Bearer <key>` header
 *   2. `X-API-Key: <key>` header
 *   3. `api_key` query parameter
 *
 * Validation rules (configurable via ApiKeyOptions):
 *   - Must be non-empty after trimming
 *   - Must match the configured key format (default: alphanumeric + hyphens/underscores, 16-128 chars)
 *
 * The module intentionally has no external dependencies so it can be tested
 * in complete isolation.
 */

import type { Request } from 'express';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApiKeyOptions {
  /**
   * Custom regex to validate the key format.
   * Default: /^[A-Za-z0-9_-]{16,128}$/
   */
  pattern?: RegExp;
}

export interface ApiKeyResult {
  /** Extracted key value, or null when not found. */
  key: string | null;
  /** Where the key was sourced from. */
  source: 'bearer' | 'header' | 'query' | null;
  /** Validation error message, or null when valid. */
  error: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default format: alphanumeric with hyphens/underscores, 16–128 characters. */
export const DEFAULT_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Header name for explicit API key header (case-insensitive in Express). */
export const API_KEY_HEADER = 'x-api-key';

/** Query parameter name for API key. */
export const API_KEY_QUERY_PARAM = 'api_key';

// ─── Core function ───────────────────────────────────────────────────────────

/**
 * Extract and validate the API key from an incoming Express request.
 *
 * @example
 * ```ts
 * const { key, error } = resolveApiKey(req);
 * if (error || !key) {
 *   res.status(401).json({ error: { code: 'MISSING_API_KEY', message: error } });
 *   return;
 * }
 * ```
 */
export function resolveApiKey(
  req: Request,
  options: ApiKeyOptions = {},
): ApiKeyResult {
  const pattern = options.pattern ?? DEFAULT_KEY_PATTERN;

  // 1. Authorization: Bearer <key>
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const candidate = authHeader.slice(7).trim();
    return validate(candidate, 'bearer', pattern);
  }

  // 2. X-API-Key header
  const apiKeyHeader = req.headers[API_KEY_HEADER];
  if (apiKeyHeader) {
    const candidate = (Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader).trim();
    return validate(candidate, 'header', pattern);
  }

  // 3. Query parameter
  const queryParam = req.query[API_KEY_QUERY_PARAM];
  if (queryParam) {
    const candidate = (Array.isArray(queryParam) ? queryParam[0] : String(queryParam)).trim();
    return validate(candidate, 'query', pattern);
  }

  return { key: null, source: null, error: 'API key is required' };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function validate(
  candidate: string,
  source: 'bearer' | 'header' | 'query',
  pattern: RegExp,
): ApiKeyResult {
  if (!candidate) {
    return { key: null, source, error: 'API key must not be empty' };
  }

  if (!pattern.test(candidate)) {
    return { key: null, source, error: 'API key format is invalid' };
  }

  return { key: candidate, source, error: null };
}
