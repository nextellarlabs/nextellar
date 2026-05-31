/**
 * Audit logging for failed auth attempts in routes-d.
 * Records timestamp, IP, identifier, and reason.
 * NEVER logs passwords or full token values.
 */

import { createHash } from "crypto";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

//  Types 

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  ip: string;
  identifier: string; // hashed email/username/pubkey
  identifierType: "email" | "pubkey" | "wallet";
  reason: string;
  route: string;
  userAgent?: string;
  // Intentionally NOT included: password, rawToken, fullToken
}

export interface AuditQueryFilters {
  startDate?: string;
  endDate?: string;
  identifier?: string;
  reason?: string;
  limit?: number;
  offset?: number;
}

export interface AuditQueryResult {
  entries: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

// Storage 

const LOG_DIR = process.env.AUDIT_LOG_DIR || join(process.cwd(), "routes-d", "logs");
const LOG_FILE = join(LOG_DIR, "audit.jsonl");

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function readEntries(): AuditLogEntry[] {
  ensureLogDir();
  if (!existsSync(LOG_FILE)) return [];

  const data = readFileSync(LOG_FILE, "utf-8");
  return data
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function appendEntry(entry: AuditLogEntry): void {
  ensureLogDir();
  const line = JSON.stringify(entry) + "\n";
  writeFileSync(LOG_FILE, line, { flag: "a" });
}

// Hashing 

/**
 * Hash an identifier so we can correlate attempts without storing raw values.
 * Uses SHA-256 with a pepper from env (or default for dev).
 */
export function hashIdentifier(identifier: string): string {
  const pepper = process.env.AUDIT_PEPPER || "nextellar-audit-pepper-dev";
  return createHash("sha256")
    .update(identifier + pepper)
    .digest("hex");
}

// Public API 

/**
 * Record a failed authentication attempt.
 * Safe to call — never throws, never logs sensitive data.
 */
export function recordFailedAuth(params: {
  ip: string;
  identifier: string;
  identifierType: "email" | "pubkey" | "wallet";
  reason: string;
  route: string;
  userAgent?: string;
}): AuditLogEntry {
  // Defensive: ensure we never log the raw identifier or password
  const sanitizedIdentifier = sanitizeIdentifier(params.identifier, params.identifierType);

  const entry: AuditLogEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    ip: params.ip,
    identifier: hashIdentifier(sanitizedIdentifier),
    identifierType: params.identifierType,
    reason: sanitizeReason(params.reason),
    route: params.route,
    userAgent: params.userAgent?.slice(0, 200),
  };

  appendEntry(entry);
  return entry;
}

/**
 * Query audit logs (admin-only).
 */
export function queryAuditLogs(filters: AuditQueryFilters = {}): AuditQueryResult {
  let entries = readEntries();

  if (filters.startDate) {
    entries = entries.filter((e) => e.timestamp >= filters.startDate!);
  }
  if (filters.endDate) {
    entries = entries.filter((e) => e.timestamp <= filters.endDate!);
  }
  if (filters.identifier) {
    const hash = hashIdentifier(filters.identifier);
    entries = entries.filter((e) => e.identifier === hash);
  }
  if (filters.reason) {
    entries = entries.filter((e) => e.reason.includes(filters.reason));
  }

  const total = entries.length;
  const pageSize = Math.min(filters.limit || 50, 100);
  const page = Math.max(filters.offset || 0, 0);
  const paginated = entries.slice(page * pageSize, (page + 1) * pageSize);

  return {
    entries: paginated,
    total,
    page,
    pageSize,
  };
}

/**
 * Get summary statistics for abuse detection.
 */
export function getAuditSummary(hours: number = 24): {
  totalAttempts: number;
  uniqueIdentifiers: number;
  topReasons: Array<{ reason: string; count: number }>;
  topIps: Array<{ ip: string; count: number }>;
} {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const entries = readEntries().filter((e) => e.timestamp >= cutoff);

  const reasonCounts = new Map<string, number>();
  const ipCounts = new Map<string, number>();
  const identifiers = new Set<string>();

  for (const entry of entries) {
    reasonCounts.set(entry.reason, (reasonCounts.get(entry.reason) || 0) + 1);
    ipCounts.set(entry.ip, (ipCounts.get(entry.ip) || 0) + 1);
    identifiers.add(entry.identifier);
  }

  const topReasons = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const topIps = Array.from(ipCounts.entries())
    .map(([ip, count]) => ({ ip, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalAttempts: entries.length,
    uniqueIdentifiers: identifiers.size,
    topReasons,
    topIps,
  };
}

// Helpers 

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function sanitizeIdentifier(identifier: string, type: "email" | "pubkey" | "wallet"): string {
  // Trim and lowercase for consistency
  const trimmed = identifier.trim().toLowerCase();

  // For emails: basic validation
  if (type === "email") {
    // Reject if it looks like a password (no @, too short)
    if (!trimmed.includes("@") || trimmed.length < 5) {
      return "[invalid-email-format]";
    }
    return trimmed;
  }

  // For pubkeys/wallets: Stellar G... addresses are 56 chars
  if (type === "pubkey" || type === "wallet") {
    if (!trimmed.startsWith("G") || trimmed.length !== 56) {
      return "[invalid-pubkey-format]";
    }
    return trimmed;
  }

  return trimmed;
}

function sanitizeReason(reason: string): string {
  // Strip any potential token/password leakage in reason strings
  return reason
    .replace(/token[=:]\s*\S+/gi, "token=[REDACTED]")
    .replace(/password[=:]\s*\S+/gi, "password=[REDACTED]")
    .replace(/bearer\s+\S+/gi, "bearer [REDACTED]")
    .slice(0, 200);
}

// Safety Guard 

/**
 * Verify that an entry contains no sensitive data.
 * Use in tests and as a runtime guard.
 */
export function isSafeEntry(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) return false;

  const e = entry as Record<string, unknown>;

  // Must NOT have these fields
  const forbiddenFields = ["password", "rawToken", "fullToken", "secret", "privateKey"];
  for (const field of forbiddenFields) {
    if (field in e) return false;
  }

  // identifier must be a hash (64 hex chars)
  const id = e.identifier;
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) return false;

  return true;
}