import crypto from "node:crypto";
import type { JwtPayload } from "jsonwebtoken";
import { randomId, signJwt, verifyJwt } from "./tokens.js";
import { issueNextellarSession, sessionStore, type SessionRecord } from "./session.js";

const MAGIC_LINK_SECRET_NAME = "NEXTELLAR_MAGIC_LINK_SECRET";
const MAGIC_LINK_TTL_SECONDS = Number(process.env.NEXTELLAR_MAGIC_LINK_TTL_SECONDS ?? 15 * 60);
const MAGIC_LINK_BASE_URL = process.env.NEXTELLAR_MAGIC_LINK_BASE_URL ?? "https://nextellar.local/auth/magic/consume";

export interface MagicLinkClaims extends JwtPayload {
  jti: string;
  sub: string;
  kind: "magic-link";
  iat?: number;
  exp?: number;
}

export interface MagicLinkRecord {
  tokenId: string;
  accountId: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
  token: string;
  redirectTo?: string;
}

export interface MagicLinkRequestInput {
  accountId: string;
  redirectTo?: string;
}

export interface MagicLinkConsumeResult {
  accountId: string;
  session: SessionRecord;
  magicLink: MagicLinkRecord;
}

export const magicLinkStore = new Map<string, MagicLinkRecord>();

export function createMagicLink(input: MagicLinkRequestInput): MagicLinkRecord {
  const now = Math.floor(Date.now() / 1000);
  const tokenId = randomId("magic");
  const claims: MagicLinkClaims = {
    jti: tokenId,
    sub: input.accountId,
    kind: "magic-link",
    iat: now,
    exp: now + MAGIC_LINK_TTL_SECONDS,
  };

  const token = signJwt(claims, MAGIC_LINK_SECRET_NAME, {
    expiresIn: MAGIC_LINK_TTL_SECONDS,
    subject: input.accountId,
    issuer: "nextellar",
    audience: "nextellar-auth",
    secretFallback: "nextellar-routes-d-magic-secret",
  });

  const record: MagicLinkRecord = {
    tokenId,
    accountId: input.accountId,
    createdAt: now * 1000,
    expiresAt: (now + MAGIC_LINK_TTL_SECONDS) * 1000,
    token,
    redirectTo: input.redirectTo,
  };

  magicLinkStore.set(tokenId, record);
  return record;
}

export function buildMagicLinkUrl(record: MagicLinkRecord): string {
  const url = new URL(MAGIC_LINK_BASE_URL);
  url.searchParams.set("token", record.token);
  if (record.redirectTo) {
    url.searchParams.set("redirectTo", record.redirectTo);
  }
  return url.toString();
}

export function consumeMagicLink(token: string): MagicLinkConsumeResult | null {
  const claims = verifyJwt<MagicLinkClaims>(
    token,
    MAGIC_LINK_SECRET_NAME,
    {
      algorithms: ["HS256"],
      issuer: "nextellar",
      audience: "nextellar-auth",
    },
    "nextellar-routes-d-magic-secret",
  );

  if (!claims?.jti || !claims.sub) {
    return null;
  }

  const record = magicLinkStore.get(claims.jti);
  if (!record) {
    return null;
  }

  if (record.usedAt) {
    return null;
  }

  if (record.expiresAt <= Date.now()) {
    magicLinkStore.delete(record.tokenId);
    return null;
  }

  record.usedAt = Date.now();
  const session = issueNextellarSession(record.accountId);

  return {
    accountId: record.accountId,
    session,
    magicLink: record,
  };
}

export function pruneExpiredMagicLinks(now = Date.now()): number {
  let removed = 0;
  for (const [tokenId, record] of magicLinkStore.entries()) {
    if (record.expiresAt <= now) {
      magicLinkStore.delete(tokenId);
      removed += 1;
    }
  }
  return removed;
}

export function getSessionForMagicLink(tokenId: string): SessionRecord | undefined {
  const record = magicLinkStore.get(tokenId);
  if (!record) {
    return undefined;
  }

  for (const session of sessionStore.values()) {
    if (session.accountId === record.accountId && session.issuedAt >= record.createdAt) {
      return session;
    }
  }

  return undefined;
}
