import type { CookieOptions } from "express";
import type { JwtPayload } from "jsonwebtoken";
import { randomId, signJwt, verifyJwt } from "./tokens.js";

export const SESSION_COOKIE_NAME = "session";

const SESSION_SECRET_NAME = "NEXTELLAR_SESSION_SECRET";
const SESSION_TTL_SECONDS = Number(process.env.NEXTELLAR_SESSION_TTL_SECONDS ?? 60 * 60 * 24);

export interface SessionClaims extends JwtPayload {
  sid: string;
  sub: string;
  kind: "session";
  iat?: number;
  exp?: number;
}

export interface SessionRecord {
  sessionId: string;
  accountId: string;
  issuedAt: number;
  expiresAt: number;
  token: string;
}

export const sessionStore = new Map<string, SessionRecord>();

export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}

export function issueNextellarSession(accountId: string): SessionRecord {
  const now = Math.floor(Date.now() / 1000);
  const sessionId = randomId("sess");
  const claims: SessionClaims = {
    sid: sessionId,
    sub: accountId,
    kind: "session",
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };

  const token = signJwt(claims, SESSION_SECRET_NAME, {
    expiresIn: SESSION_TTL_SECONDS,
    issuer: "nextellar",
    audience: "nextellar-app",
    secretFallback: "nextellar-routes-d-session-secret",
  });

  const record: SessionRecord = {
    sessionId,
    accountId,
    issuedAt: now * 1000,
    expiresAt: (now + SESSION_TTL_SECONDS) * 1000,
    token,
  };

  sessionStore.set(sessionId, record);
  return record;
}

export function verifySessionToken(token: string): SessionClaims | null {
  return verifyJwt<SessionClaims>(
    token,
    SESSION_SECRET_NAME,
    {
      algorithms: ["HS256"],
      issuer: "nextellar",
      audience: "nextellar-app",
    },
    "nextellar-routes-d-session-secret",
  );
}
