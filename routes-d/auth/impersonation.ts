import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const IMPERSONATION_SECRET = process.env.NEXTELLAR_IMPERSONATION_SECRET || 'dev-secret';
const IMPERSONATION_TTL_SECONDS = 10 * 60; // 10 minutes

/**
 * Payload stored in the impersonation JWT.
 */
export interface ImpersonationPayload {
  jti: string; // token identifier for revocation/audit
  operatorId: string;
  targetUserId: string;
  iat: number;
  exp: number;
}

/** Create a short‑lived impersonation token. */
export function createImpersonationToken(operatorId: string, targetUserId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: ImpersonationPayload = {
    jti: uuidv4(),
    operatorId,
    targetUserId,
    iat: now,
    exp: now + IMPERSONATION_TTL_SECONDS,
  };
  return jwt.sign(payload, IMPERSONATION_SECRET);
}

/** Verify a token and return its payload, or null if invalid/expired. */
export function verifyImpersonationToken(token: string): ImpersonationPayload | null {
  try {
    const decoded = jwt.verify(token, IMPERSONATION_SECRET) as ImpersonationPayload;
    return decoded;
  } catch (e) {
    return null;
  }
}
