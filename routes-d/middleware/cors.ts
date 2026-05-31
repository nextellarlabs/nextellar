import type { Request, Response, NextFunction } from "express";

const DEFAULT_ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const DEFAULT_ALLOWED_HEADERS = "Content-Type, Authorization";

/**
 * Parse the ALLOWED_ORIGINS environment variable into a Set.
 * Accepts a comma-separated list of exact origin strings.
 * An empty or absent value means no origin is permitted.
 */
function parseAllowedOrigins(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  );
}

/**
 * CORS allowed-origin validator middleware for routes-d.
 *
 * Behaviour:
 * - Requests with no Origin header pass through untouched.
 * - Requests whose Origin is in the ALLOWED_ORIGINS allowlist receive the
 *   standard CORS headers including `Access-Control-Allow-Credentials: true`.
 * - Requests from an unlisted origin are rejected with 403 and **no**
 *   Access-Control-Allow-Origin header is written, so the disallowed origin
 *   is never echoed back to the client.
 *
 * Configuration (environment variables):
 * - ALLOWED_ORIGINS  Comma-separated list of exact origins to permit.
 *                    Example: https://app.nextellar.dev,https://admin.nextellar.dev
 */
export function corsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestOrigin = req.header("Origin");

  // No Origin header — same-origin or non-browser request; proceed normally.
  if (!requestOrigin) {
    next();
    return;
  }

  const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

  if (!allowedOrigins.has(requestOrigin)) {
    // Reject without reflecting the origin in any header.
    res.status(403).json({ success: false, message: "Origin not allowed" });
    return;
  }

  // Allowlisted: set precise CORS headers and enable credentials.
  res.setHeader("Access-Control-Allow-Origin", requestOrigin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", DEFAULT_ALLOWED_METHODS);
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.header("Access-Control-Request-Headers") ?? DEFAULT_ALLOWED_HEADERS,
  );
  // Vary: Origin prevents caches from serving a cached ACAO header to a
  // different origin.
  res.setHeader("Vary", "Origin");

  // Handle CORS preflight.
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
}

export default corsMiddleware;
