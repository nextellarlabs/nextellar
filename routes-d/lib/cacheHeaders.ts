// Cache header helper for routes-d (#349).
//
// Generates a stable ETag from the response payload and applies
// CDN-friendly cache headers. If the caller presents a matching
// `If-None-Match` value we short-circuit with a 304 response.

import { createHash } from "node:crypto";
import type { Response } from "express";

export interface CacheHeadersOptions {
  /** Cache lifetime in seconds. Default 60. */
  maxAgeSeconds?: number;
  /** Shared cache lifetime in seconds. Default 300. */
  sMaxAgeSeconds?: number;
  /** Marks the response as publicly cacheable. Default true. */
  public?: boolean;
}

export interface CacheHeadersResult {
  etag: string;
  cacheControl: string;
  notModified: boolean;
}

function normalizePayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

export function createPayloadEtag(payload: unknown): string {
  const normalized = normalizePayload(payload);
  return `W/"${createHash("sha1").update(normalized).digest("hex")}"`;
}

export function applyCacheHeaders(
  res: Pick<Response, "setHeader" | "status">,
  payload: unknown,
  reqHeaders: Record<string, string | string[] | undefined>,
  options: CacheHeadersOptions = {},
): CacheHeadersResult {
  const etag = createPayloadEtag(payload);
  const maxAgeSeconds = options.maxAgeSeconds ?? 60;
  const sMaxAgeSeconds = options.sMaxAgeSeconds ?? 300;
  const visibility = (options.public ?? true) ? "public" : "private";
  const cacheControl = `${visibility}, max-age=${maxAgeSeconds}, s-maxage=${sMaxAgeSeconds}`;
  const ifNoneMatch = reqHeaders["if-none-match"];
  const incoming = Array.isArray(ifNoneMatch) ? ifNoneMatch.join(",") : ifNoneMatch;
  const notModified = typeof incoming === "string" && incoming === etag;

  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", cacheControl);

  if (notModified) {
    res.status(304);
  }

  return { etag, cacheControl, notModified };
}
