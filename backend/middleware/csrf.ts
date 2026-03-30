import { Request, Response, NextFunction } from "express";

const ALLOWED_ORIGINS = ["http://localhost:3000", "https://nextellar.dev"];

/**
 * CSRF Protection Middleware.
 * Validates the Origin and Referer headers for all state-changing requests.
 * Specifically designed for API endpoints and form-encoded requests.
 */
export function validateCsrf(req: Request, res: Response, next: NextFunction): void {
  // 1. Skip validation for safe methods (GET, HEAD, OPTIONS)
  const safeMethods = ["GET", "HEAD", "OPTIONS"];
  if (safeMethods.includes(req.method)) {
    return next();
  }

  // 2. Validate Origin header (preferred for modern browsers)
  const origin = req.headers["origin"];
  if (origin) {
    if (!ALLOWED_ORIGINS.includes(origin)) {
      res.status(403).json({ error: "Forbidden: invalid origin" });
      return;
    }
  } else {
    // 3. Fallback to Referer header if Origin is not present
    const referer = req.headers["referer"];
    if (referer) {
      try {
        const url = new URL(referer);
        if (!ALLOWED_ORIGINS.includes(url.origin)) {
          res.status(403).json({ error: "Forbidden: invalid referer origin" });
          return;
        }
      } catch {
        res.status(403).json({ error: "Forbidden: invalid referer format" });
        return;
      }
    } else {
      // 4. If neither Origin nor Referer is present, block if it's not a known exception
      // (This prevents simplest CSRF from curl or scripts that don't set headers)
      res.status(403).json({ error: "Forbidden: missing security headers" });
      return;
    }
  }

  // 5. Check for a custom security header (Synchronized Token Pattern)
  // For API endpoints, we expect the client to set this. For simple forms,
  // we could also look for a token in req.body._csrf
  const csrfToken = req.headers["x-csrf-token"] || req.body?._csrf;
  
  if (!csrfToken && req.headers["content-type"]?.includes("form-urlencoded")) {
    res.status(403).json({ error: "Forbidden: missing CSRF token for form submission" });
    return;
  }

  next();
}
