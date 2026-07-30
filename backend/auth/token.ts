import jwt from "jsonwebtoken";
import crypto from "crypto";

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
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn,
    issuer: process.env.JWT_ISSUER || 'nextellar',
    audience: process.env.JWT_AUDIENCE || 'nextellar-app',
    algorithm: 'HS256',
  });
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

// ---------------------------------------------------------------------------
// Refresh Token Rotation (RTR) Lineage & Storage
// ---------------------------------------------------------------------------

export type RefreshTokenPayload = {
  jti: string; // Unique Token ID
  sub: string; // User ID
  familyId: string; // Lineage Family ID
};

export type RefreshTokenRecord = {
  id: string;
  userId: string;
  familyId: string;
  parentId?: string;
  expiresAt: number;
  used: boolean;
  revoked: boolean;
};

export const refreshTokenStore = new Map<string, RefreshTokenRecord>();

export function signRefreshToken(userId: string, familyId?: string, expiresIn = "7d"): string {
  const tokenId = crypto.randomUUID();
  const actualFamilyId = familyId || tokenId;

  const payload: RefreshTokenPayload = {
    jti: tokenId,
    sub: userId,
    familyId: actualFamilyId,
  };

  let durationMs = 7 * 24 * 60 * 60 * 1000;
  if (expiresIn.endsWith("d")) {
    durationMs = parseInt(expiresIn) * 24 * 60 * 60 * 1000;
  } else if (expiresIn.endsWith("h")) {
    durationMs = parseInt(expiresIn) * 60 * 60 * 1000;
  } else if (expiresIn.endsWith("m")) {
    durationMs = parseInt(expiresIn) * 60 * 1000;
  } else if (expiresIn.endsWith("s")) {
    durationMs = parseInt(expiresIn) * 1000;
  }

  const record: RefreshTokenRecord = {
    id: tokenId,
    userId,
    familyId: actualFamilyId,
    expiresAt: Date.now() + durationMs,
    used: false,
    revoked: false,
  };

  refreshTokenStore.set(tokenId, record);

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn,
    issuer: process.env.JWT_ISSUER || 'nextellar',
    audience: process.env.JWT_AUDIENCE || 'nextellar-app',
    algorithm: 'HS256',
  });
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: process.env.JWT_ISSUER || 'nextellar',
      audience: process.env.JWT_AUDIENCE || 'nextellar-app',
    }) as RefreshTokenPayload & { iat?: number; exp?: number };

    if (!decoded.jti || !decoded.sub || !decoded.familyId) {
      throw new Error('Invalid refresh token payload');
    }

    return decoded;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new Error('Refresh token has expired');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid refresh token signature or format');
    }
    throw err;
  }
}

export async function rotateRefreshToken(tokenStr: string): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
  const payload = verifyRefreshToken(tokenStr);
  const record = refreshTokenStore.get(payload.jti);

  if (!record) {
    throw new Error('Refresh token not found in storage');
  }

  if (record.revoked) {
    throw new Error('Refresh token is revoked');
  }

  if (record.expiresAt < Date.now()) {
    throw new Error('Refresh token has expired');
  }

  if (record.used) {
    // REUSE DETECTED!
    // Revoke the entire lineage family
    for (const r of refreshTokenStore.values()) {
      if (r.familyId === record.familyId) {
        r.revoked = true;
      }
    }
    throw new Error('Refresh token reuse detected. Lineage chain revoked.');
  }

  // Mark old token as used
  record.used = true;

  // Issue new access and refresh tokens
  const newAccessToken = signToken({ sub: record.userId, role: 'user' });
  const newRefreshToken = signRefreshToken(record.userId, record.familyId);

  // Set the parent ID for the new token in the store
  const newRecordPayload = verifyRefreshToken(newRefreshToken);
  const newRecord = refreshTokenStore.get(newRecordPayload.jti);
  if (newRecord) {
    newRecord.parentId = record.id;
  }

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    userId: record.userId,
  };
}

