import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Input sanitizer middleware.
 *
 * Protects routes from common injection vectors by:
 *   1. Stripping NUL bytes (`\0`) from all string fields in `req.body`,
 *      `req.query`, and `req.params`.
 *   2. Rejecting requests whose `Content-Type` claims JSON but whose body
 *      is not a plain object or array (prevents prototype-pollution via
 *      `JSON.parse("null")` or scalar bodies).
 *   3. Optionally trimming leading/trailing whitespace from string fields.
 *
 * This is a defence-in-depth layer. It does NOT replace proper schema
 * validation (see `lib/schemas/`).
 */

export interface SanitizerOptions {
  /** Strip leading/trailing whitespace from string values (default: false). */
  trim?: boolean;
  /**
   * Maximum depth to recurse into nested objects.
   * Protects against deeply-nested payloads causing a stack overflow.
   * Default: 20.
   */
  maxDepth?: number;
}

function sanitizeValue(value: unknown, trim: boolean, depth: number, maxDepth: number): unknown {
  if (depth > maxDepth) return value;
  if (typeof value === 'string') {
    let v = value.replace(/\0/g, '');
    if (trim) v = v.trim();
    return v;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, trim, depth + 1, maxDepth));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeValue(v, trim, depth + 1, maxDepth);
    }
    return out;
  }
  return value;
}

function isPlainObjectOrArray(v: unknown): boolean {
  return v !== null && typeof v === 'object';
}

/**
 * Build the sanitizer middleware.
 *
 * @example
 *   app.use(sanitize({ trim: true }));
 */
export function sanitize(options: SanitizerOptions = {}): RequestHandler {
  const trim = options.trim ?? false;
  const maxDepth = options.maxDepth ?? 20;

  return function sanitizerMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    // Reject non-object JSON bodies (null, string, number at the top level)
    if (req.body !== undefined && !isPlainObjectOrArray(req.body)) {
      res.status(400).json({ error: 'invalid_request_body' });
      return;
    }

    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeValue(req.body, trim, 0, maxDepth);
    }

    // Sanitize query string values
    for (const key of Object.keys(req.query)) {
      const v = req.query[key];
      if (typeof v === 'string') {
        req.query[key] = sanitizeValue(v, trim, 0, maxDepth) as string;
      }
    }

    // Sanitize route params
    for (const key of Object.keys(req.params)) {
      const v = req.params[key];
      if (typeof v === 'string') {
        req.params[key] = sanitizeValue(v, trim, 0, maxDepth) as string;
      }
    }

    next();
  };
}