import * as crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type CanonicalRequestParts = {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
};

export type HmacOptions = {
  secret: string;
  maxSkewMs?: number;
  now?: () => number;
  cacheTtlMs?: number;
};

export type NonceStore = {
  has: (nonce: string) => boolean;
  add: (nonce: string) => void;
};

class SlidingNonceCache implements NonceStore {
  private readonly store = new Map<string, number>();

  constructor(
    private readonly now: () => number,
    private readonly ttlMs: number,
  ) {}

  has(nonce: string): boolean {
    this.pruneExpired();
    const expiresAt = this.store.get(nonce);
    return typeof expiresAt === "number" && expiresAt > this.now();
  }

  add(nonce: string): void {
    this.pruneExpired();
    this.store.set(nonce, this.now() + this.ttlMs);
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [nonce, expiresAt] of this.store.entries()) {
      if (expiresAt <= now) {
        this.store.delete(nonce);
      }
    }
  }
}

export function sha256Base64(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("base64");
}

export function buildCanonicalSigningString(parts: CanonicalRequestParts): string {
  return [parts.method.toUpperCase(), parts.path, parts.timestamp, parts.nonce, parts.bodyHash].join("\n");
}

export function signCanonicalString(secret: string, canonical: string): string {
  return crypto.createHmac("sha256", secret).update(canonical, "utf8").digest("base64");
}

export function createHmacMiddleware(options: HmacOptions) {
  const now = options.now ?? Date.now;
  const maxSkewMs = options.maxSkewMs ?? 5 * 60 * 1000;
  const nonceStore = new SlidingNonceCache(now, options.cacheTtlMs ?? maxSkewMs);

  return function hmacMiddleware(req: Request, res: Response, next: NextFunction) {
    const signature = req.header("x-signature");
    const timestamp = req.header("x-timestamp");
    const nonce = req.header("x-nonce");

    if (!signature || !timestamp || !nonce) {
      return res.status(401).json({ error: "hmac_missing_headers" });
    }

    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) {
      return res.status(401).json({ error: "hmac_invalid_timestamp" });
    }

    if (Math.abs(now() - ts) > maxSkewMs) {
      return res.status(401).json({ error: "hmac_expired_request" });
    }

    if (nonceStore.has(nonce)) {
      return res.status(409).json({ error: "hmac_replay_detected" });
    }

    const body = req.body ? JSON.stringify(req.body) : "";
    const canonical = buildCanonicalSigningString({
      method: req.method,
      path: req.path,
      timestamp,
      nonce,
      bodyHash: sha256Base64(body),
    });
    const expected = signCanonicalString(options.secret, canonical);

    const actual = Buffer.from(signature, "utf8");
    const expectedBuf = Buffer.from(expected, "utf8");
    if (actual.length !== expectedBuf.length || !crypto.timingSafeEqual(actual, expectedBuf)) {
      return res.status(401).json({ error: "hmac_signature_mismatch" });
    }

    nonceStore.add(nonce);
    return next();
  };
}
