// CSRF token rotation middleware (Issue #318).
//
// Rotates CSRF tokens on every authenticated request by validating the
// current token and issuing a new one. Uses constant-time comparison to
// prevent timing attacks.

import { randomBytes } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const CSRF_TOKEN_HEADER = 'x-csrf-token';
const CSRF_TOKEN_COOKIE = 'csrf-token';
const CSRF_TOKEN_LENGTH = 32; // 256 bits

export interface CsrfMiddlewareOptions {
  /** Header name for CSRF token (default: x-csrf-token) */
  headerName?: string;
  /** Cookie name for CSRF token (default: csrf-token) */
  cookieName?: string;
  /** Methods that require CSRF protection (default: POST, PUT, DELETE, PATCH) */
  protectedMethods?: string[];
  /** Whether to rotate token on every request (default: true) */
  rotateOnEveryRequest?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      csrfToken?: string;
    }
  }
}

/**
 * Generate a new CSRF token.
 *
 * @returns Base64-encoded random token
 */
function generateToken(): string {
  return randomBytes(CSRF_TOKEN_LENGTH).toString('base64');
}

/**
 * Constant-time token comparison to prevent timing attacks.
 *
 * @param a First token
 * @param b Second token
 * @returns true if tokens match
 */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Create CSRF token rotation middleware.
 *
 * Validates CSRF tokens on state-changing requests (POST, PUT, DELETE, PATCH)
 * and rotates the token on every authenticated request.
 *
 * @param options Configuration options
 * @returns Express middleware function
 *
 * @example
 * app.use(requireJwt());
 * app.use(createCsrfMiddleware());
 * app.post('/transfer', (req, res) => {
 *   // CSRF token validated and rotated
 *   res.setHeader('x-csrf-token', req.csrfToken);
 * });
 */
export function createCsrfMiddleware(
  options: CsrfMiddlewareOptions = {},
): (req: Request, res: Response, next: NextFunction) => void {
  const headerName = options.headerName ?? CSRF_TOKEN_HEADER;
  const cookieName = options.cookieName ?? CSRF_TOKEN_COOKIE;
  const protectedMethods = options.protectedMethods ?? ['POST', 'PUT', 'DELETE', 'PATCH'];
  const rotateOnEveryRequest = options.rotateOnEveryRequest ?? true;

  return (req: Request, res: Response, next: NextFunction) => {
    // Only apply to authenticated requests (assumes JWT middleware ran first)
    if (!req.jwt) {
      return next();
    }

    const method = req.method.toUpperCase();
    const currentToken = req.cookies?.[cookieName];

    // Validate token on state-changing requests
    if (protectedMethods.includes(method)) {
      const providedToken = req.headers[headerName.toLowerCase()] as string | undefined;

      if (!providedToken || !currentToken) {
        return res.status(403).json({
          error: 'csrf_token_missing',
        });
      }

      if (!tokensMatch(providedToken, currentToken)) {
        return res.status(403).json({
          error: 'csrf_token_invalid',
        });
      }
    }

    // Generate new token for response
    const newToken = generateToken();
    req.csrfToken = newToken;

    // Set token in response cookie (httpOnly, secure in production)
    res.cookie(cookieName, newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600000, // 1 hour
    });

    // Also set in response header for SPA convenience
    res.setHeader(headerName, newToken);

    next();
  };
}

/**
 * Middleware to issue initial CSRF token (for login/unauthenticated endpoints).
 *
 * @param options Configuration options
 * @returns Express middleware function
 *
 * @example
 * app.post('/login', issueCsrfToken(), (req, res) => {
 *   // Token issued in response
 * });
 */
export function issueCsrfToken(
  options: CsrfMiddlewareOptions = {},
): (req: Request, res: Response, next: NextFunction) => void {
  const cookieName = options.cookieName ?? CSRF_TOKEN_COOKIE;
  const headerName = options.headerName ?? CSRF_TOKEN_HEADER;

  return (req: Request, res: Response, next: NextFunction) => {
    const token = generateToken();
    req.csrfToken = token;

    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 3600000, // 1 hour
    });

    res.setHeader(headerName, token);
    next();
  };
}
