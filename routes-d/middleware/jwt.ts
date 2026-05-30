import type { Request, Response, NextFunction } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { requireSecret } from "../lib/tokens.js";
import { tokenVersionStore, type TokenVersionStore } from "../auth/tokenVersion.js";

// JWT validation middleware (#261).
//
// - Verifies signature (HS256), expiry, issuer, and audience.
// - Returns a fixed error shape `{ error: "unauthorized" }` for any failure
//   so we don't leak whether the token was expired, malformed, or had a bad
//   audience.
// - Optional per-route scope requirements: route opts in by passing
//   `requireJwt({ scopes: ["transfer:write"] })`.
// - When `tokenVersionStore.current(sub)` is set, tokens carrying a stale
//   `tv` claim are rejected (this wires up the password-change revocation
//   from #262).

const JWT_SECRET_NAME = "NEXTELLAR_JWT_SECRET";
const JWT_FALLBACK_SECRET = "nextellar-routes-d-jwt-secret";

const JWT_ISSUER = process.env.NEXTELLAR_JWT_ISSUER?.trim() || "nextellar";
const JWT_AUDIENCE =
  process.env.NEXTELLAR_JWT_AUDIENCE?.trim() || "nextellar-app";

export interface JwtClaims extends JwtPayload {
  sub: string;
  scopes?: string[];
  tv?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      jwt?: JwtClaims;
    }
  }
}

export interface RequireJwtOptions {
  scopes?: string[];
  versionStore?: TokenVersionStore;
  secretName?: string;
  secretFallback?: string;
  issuer?: string;
  audience?: string;
}

function unauthorized(res: Response) {
  return res.status(401).json({ error: "unauthorized" });
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    return token.length > 0 ? token : null;
  }
  return null;
}

export function verifyJwtToken(
  token: string,
  options: RequireJwtOptions = {},
): JwtClaims | null {
  try {
    const secret = requireSecret(
      options.secretName ?? JWT_SECRET_NAME,
      options.secretFallback ?? JWT_FALLBACK_SECRET,
    );
    return jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: options.issuer ?? JWT_ISSUER,
      audience: options.audience ?? JWT_AUDIENCE,
    }) as JwtClaims;
  } catch {
    return null;
  }
}

export function requireJwt(options: RequireJwtOptions = {}) {
  const versionStore = options.versionStore ?? tokenVersionStore;
  const requiredScopes = options.scopes ?? [];

  return function jwtMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const token = extractToken(req);
    if (!token) {
      return unauthorized(res);
    }

    const claims = verifyJwtToken(token, options);
    if (!claims || typeof claims.sub !== "string" || claims.sub.length === 0) {
      return unauthorized(res);
    }

    if (versionStore.current(claims.sub) > 0) {
      if (!versionStore.isCurrent(claims.sub, claims.tv)) {
        return unauthorized(res);
      }
    }

    if (requiredScopes.length > 0) {
      const granted = Array.isArray(claims.scopes) ? claims.scopes : [];
      const allowed = requiredScopes.every((scope) => granted.includes(scope));
      if (!allowed) {
        return res.status(403).json({ error: "forbidden" });
      }
    }

    req.jwt = claims;
    return next();
  };
}
