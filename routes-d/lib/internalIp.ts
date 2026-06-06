import type { Request } from "express";

const PRIVATE_V4_PREFIXES = [
  /^127\./u,
  /^10\./u,
  /^192\.168\./u,
  /^172\.(1[6-9]|2\d|3[0-1])\./u,
];

const PRIVATE_V6_PREFIXES = [/^::1$/u, /^fc/u, /^fd/u];
const MAPPED_V4_PREFIXES = [/^::ffff:127\./u, /^::ffff:10\./u, /^::ffff:192\.168\./u, /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./u];

export function isInternalIp(value: string): boolean {
  return (
    PRIVATE_V4_PREFIXES.some((pattern) => pattern.test(value)) ||
    PRIVATE_V6_PREFIXES.some((pattern) => pattern.test(value)) ||
    MAPPED_V4_PREFIXES.some((pattern) => pattern.test(value))
  );
}

export function getRequestIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.ip || req.socket.remoteAddress || "";
}

export function isInternalRequest(req: Request): boolean {
  return isInternalIp(getRequestIp(req));
}
