import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  recordFailedAuth,
  queryAuditLogs,
  getAuditSummary,
  hashIdentifier,
  isSafeEntry,
} from "../lib/auditLog.js";
import { existsSync, unlinkSync, rmdirSync } from "fs";
import { join } from "path";

const TEST_LOG_DIR = join(process.cwd(), "routes-d", "logs-test");
const TEST_LOG_FILE = join(TEST_LOG_DIR, "audit.jsonl");

// Override log dir for tests
process.env.AUDIT_LOG_DIR = TEST_LOG_DIR;

function cleanup(): void {
  if (existsSync(TEST_LOG_FILE)) unlinkSync(TEST_LOG_FILE);
  if (existsSync(TEST_LOG_DIR)) rmdirSync(TEST_LOG_DIR);
}

describe("auditLog", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  // Basic Recording

  it("records a failed auth attempt", () => {
    const entry = recordFailedAuth({
      ip: "192.168.1.1",
      identifier: "user@example.com",
      identifierType: "email",
      reason: "Invalid password",
      route: "POST /api/auth/login",
      userAgent: "Mozilla/5.0",
    });

    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.ip).toBe("192.168.1.1");
    expect(entry.identifierType).toBe("email");
    expect(entry.reason).toBe("Invalid password");
    expect(entry.route).toBe("POST /api/auth/login");
  });

  // Sensitive Data Protection

  it("hashes the identifier, never stores raw", () => {
    const entry = recordFailedAuth({
      ip: "1.1.1.1",
      identifier: "sensitive@email.com",
      identifierType: "email",
      reason: "Bad creds",
      route: "/login",
    });

    // Should be 64-char hex (SHA-256)
    expect(entry.identifier).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.identifier).not.toContain("sensitive");
    expect(entry.identifier).not.toContain("@");
  });

  it("never logs password in reason", () => {
    const entry = recordFailedAuth({
      ip: "1.1.1.1",
      identifier: "user@test.com",
      identifierType: "email",
      reason: "password: supersecret123",
      route: "/login",
    });

    expect(entry.reason).not.toContain("supersecret123");
    expect(entry.reason).toContain("[REDACTED]");
  });

  it("never logs token in reason", () => {
    const entry = recordFailedAuth({
      ip: "1.1.1.1",
      identifier: "user@test.com",
      identifierType: "email",
      reason: "Invalid bearer eyJhbGciOiJIUzI1NiIs...",
      route: "/login",
    });

    expect(entry.reason).not.toContain("eyJhbG");
    expect(entry.reason).toContain("[REDACTED]");
  });

  it("entry passes safety guard", () => {
    const entry = recordFailedAuth({
      ip: "1.1.1.1",
      identifier: "user@test.com",
      identifierType: "email",
      reason: "Bad creds",
      route: "/login",
    });

    expect(isSafeEntry(entry)).toBe(true);
  });

  it("rejects entry with password field as unsafe", () => {
    const badEntry = {
      id: "1",
      timestamp: new Date().toISOString(),
      ip: "1.1.1.1",
      identifier: "abc123".repeat(10),
      identifierType: "email",
      reason: "test",
      route: "/login",
      password: "should-not-exist",
    };

    expect(isSafeEntry(badEntry)).toBe(false);
  });

  it("rejects entry with rawToken field as unsafe", () => {
    const badEntry = {
      id: "1",
      timestamp: new Date().toISOString(),
      ip: "1.1.1.1",
      identifier: "abc123".repeat(10),
      identifierType: "email",
      reason: "test",
      route: "/login",
      rawToken: "secret-token",
    };

    expect(isSafeEntry(badEntry)).toBe(false);
  });

  // Identifier Validation 

  it("sanitizes invalid email format", () => {
    const entry = recordFailedAuth({
      ip: "1.1.1.1",
      identifier: "not-an-email",
      identifierType: "email",
      reason: "Bad format",
      route: "/login",
    });

    expect(entry.identifier).toMatch(/^[a-f0-9]{64}$/);
  });

  it("sanitizes invalid pubkey format", () => {
    const entry = recordFailedAuth({
      ip: "1.1.1.1",
      identifier: "GINVALID",
      identifierType: "pubkey",
      reason: "Bad key",
      route: "/login",
    });

    // Should hash the "[invalid-pubkey-format]" fallback
    expect(entry.identifier).toMatch(/^[a-f0-9]{64}$/);
  });

  // Querying 

  it("queries by date range", () => {
    recordFailedAuth({
      ip: "1.1.1.1",
      identifier: "user1@test.com",
      identifierType: "email",
      reason: "Bad creds",
      route: "/login",
    });

    recordFailedAuth({
      ip: "1.1.1.2",
      identifier: "user2@test.com",
      identifierType: "email",
      reason: "Bad creds",
      route: "/login",
    });

    const result = queryAuditLogs({ limit: 10 });
    expect(result.total).toBe(2);
    expect(result.entries).toHaveLength(2);
  });

  it("filters by identifier", () => {
    recordFailedAuth({
      ip: "1.1.1.1",
      identifier: "specific@user.com",
      identifierType: "email",
      reason: "Bad creds",
      route: "/login",
    });

    recordFailedAuth({
      ip: "1.1.1.2",
      identifier: "other@user.com",
      identifierType: "email",
      reason: "Bad creds",
      route: "/login",
    });

    const result = queryAuditLogs({ identifier: "specific@user.com" });
    expect(result.total).toBe(1);
    expect(result.entries[0].identifier).toBe(
      hashIdentifier("specific@user.com")
    );
  });

  it("filters by reason", () => {
    recordFailedAuth({
      ip: "1.1.1.1",
      identifier: "a@test.com",
      identifierType: "email",
      reason: "Expired token",
      route: "/login",
    });

    recordFailedAuth({
      ip: "1.1.1.2",
      identifier: "b@test.com",
      identifierType: "email",
      reason: "Wrong password",
      route: "/login",
    });

    const result = queryAuditLogs({ reason: "Expired" });
    expect(result.total).toBe(1);
  });

  it("paginates results", () => {
    for (let i = 0; i < 5; i++) {
      recordFailedAuth({
        ip: `1.1.1.${i}`,
        identifier: `user${i}@test.com`,
        identifierType: "email",
        reason: "Bad creds",
        route: "/login",
      });
    }

    const page1 = queryAuditLogs({ limit: 2, offset: 0 });
    expect(page1.entries).toHaveLength(2);
    expect(page1.total).toBe(5);

    const page2 = queryAuditLogs({ limit: 2, offset: 1 });
    expect(page2.entries).toHaveLength(2);
  });

  // ─── Summary ────────────────────────────────────────────────────

  it("generates summary statistics", () => {
    recordFailedAuth({
      ip: "1.1.1.1",
      identifier: "a@test.com",
      identifierType: "email",
      reason: "Expired token",
      route: "/login",
    });

    recordFailedAuth({
      ip: "1.1.1.1",
      identifier: "b@test.com",
      identifierType: "email",
      reason: "Expired token",
      route: "/login",
    });

    recordFailedAuth({
      ip: "1.1.1.2",
      identifier: "c@test.com",
      identifierType: "email",
      reason: "Wrong password",
      route: "/login",
    });

    const summary = getAuditSummary(24);
    expect(summary.totalAttempts).toBe(3);
    expect(summary.uniqueIdentifiers).toBe(3);
    expect(summary.topReasons[0].reason).toBe("Expired token");
    expect(summary.topReasons[0].count).toBe(2);
    expect(summary.topIps[0].ip).toBe("1.1.1.1");
    expect(summary.topIps[0].count).toBe(2);
  });
});