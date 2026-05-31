import crypto from "node:crypto";
import jwt, { type JwtPayload, type SignOptions, type VerifyOptions } from "jsonwebtoken";

const FALLBACK_SECRET = "nextellar-routes-d-dev-secret";

export function requireSecret(name: string, fallback = FALLBACK_SECRET): string {
  return process.env[name]?.trim() || fallback;
}

export function randomId(prefix = ""): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function signJwt<T extends object>(
  payload: T,
  secretName: string,
  options: SignOptions & { secretFallback?: string } = {},
): string {
  const { secretFallback, ...jwtOptions } = options;
  const secret = requireSecret(secretName, secretFallback);
  return jwt.sign(payload, secret, jwtOptions);
}

export function verifyJwt<T extends JwtPayload>(
  token: string,
  secretName: string,
  options: VerifyOptions = {},
  secretFallback?: string,
): T | null {
  try {
    const secret = requireSecret(secretName, secretFallback);
    return jwt.verify(token, secret, options) as T;
  } catch {
    return null;
  }
}
