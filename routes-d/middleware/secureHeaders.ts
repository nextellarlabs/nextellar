import type { Request, Response, NextFunction } from "express";

/**
 * Default security header values applied to every response unless opted out.
 *
 * See routes-d/docs/security.md for rationale and opt-out guidance.
 */
export const SECURE_HEADER_DEFAULTS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=()",
} as const;

export type SecureHeaderName = keyof typeof SECURE_HEADER_DEFAULTS;

/**
 * Options accepted by the per-route opt-out helper.
 */
export interface SecureHeadersOptions {
  /**
   * Headers to omit for this specific route.
   * Pass an array of header names (keys of SECURE_HEADER_DEFAULTS).
   *
   * Example — disable HSTS on a health-check route that is also served over
   * plain HTTP in local dev:
   *   secureHeaders({ omit: ["Strict-Transport-Security"] })
   */
  omit?: SecureHeaderName[];
}

/**
 * Middleware factory that sets baseline security headers.
 *
 * Usage — global (apply to every route):
 *   app.use(secureHeaders());
 *
 * Usage — per-route opt-out:
 *   app.get("/health", secureHeaders({ omit: ["Strict-Transport-Security"] }), handler);
 */
export function secureHeaders(options: SecureHeadersOptions = {}) {
  const omitSet = new Set<string>(options.omit ?? []);

  return function secureHeadersMiddleware(
    _req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    for (const [name, value] of Object.entries(SECURE_HEADER_DEFAULTS)) {
      if (!omitSet.has(name)) {
        res.setHeader(name, value);
      }
    }
    next();
  };
}

export default secureHeaders;
