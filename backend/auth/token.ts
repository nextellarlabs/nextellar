import jwt from "jsonwebtoken";

/**
 * Reads JWT_SECRET from the environment at module load time.
 * Throws immediately if the variable is absent — the server should
 * never start with an undefined signing secret.
 */
function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "Missing required environment variable: JWT_SECRET. " +
        "Set it in your .env file or deployment environment before starting the server.",
    );
  }
  return secret;
}

const JWT_SECRET = requireJwtSecret();

export type TokenPayload = {
  sub: string;
  role: string;
};

export function signToken(payload: TokenPayload, expiresIn = "1h"): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: process.env.JWT_ISSUER || 'nextellar',
      audience: process.env.JWT_AUDIENCE || 'nextellar-app',
    }) as TokenPayload & { iat?: number; exp?: number };

    if (!decoded.sub || !decoded.role) {
      throw new Error('Invalid token payload: missing required claims');
    }

    return decoded;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new Error('Token has expired');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token signature or format');
    }
    throw err;
  }
}
