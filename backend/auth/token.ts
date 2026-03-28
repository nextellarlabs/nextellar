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
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}
