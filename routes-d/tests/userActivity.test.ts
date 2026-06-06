import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "@jest/globals";
import { existsSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import {
  hashActor,
  isSafeActivityEntry,
  queryUserActivity,
  recordUserActivity,
} from "../lib/userActivity.js";
import { GET } from "../routes/userActivity.js";

const TEST_LOG_ROOT = join(process.cwd(), "routes-d", "logs-activity-test");

function setTestLogDir(): string {
  const dir = join(TEST_LOG_ROOT, `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  process.env.USER_ACTIVITY_LOG_DIR = dir;
  return dir;
}

function cleanup(dir?: string): void {
  const target = dir ?? process.env.USER_ACTIVITY_LOG_DIR;
  if (!target) return;
  const file = join(target, "user-activity.jsonl");
  if (existsSync(file)) unlinkSync(file);
  if (existsSync(target)) rmdirSync(target);
}

describe("userActivity", () => {
  let logDir = "";

  beforeEach(() => {
    logDir = setTestLogDir();
  });

  afterEach(() => {
    cleanup(logDir);
  });

  it("captures login activity with hashed actor", () => {
    const entry = recordUserActivity({
      actor: "user@example.com",
      action: "login",
      route: "POST /auth/login",
    });
    expect(entry.action).toBe("login");
    expect(entry.actor).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.actor).not.toContain("@");
  });

  it("captures password change, payment submit, and admin actions", () => {
    recordUserActivity({ actor: "user@test.com", action: "password_change", route: "POST /auth/password" });
    recordUserActivity({ actor: "user@test.com", action: "payment_submit", target: "pay-1", route: "POST /payments" });
    recordUserActivity({ actor: "admin@test.com", action: "admin_action", target: "user-2", route: "POST /admin/users" });

    const result = queryUserActivity({ actor: "user@test.com" });
    expect(result.total).toBe(2);
  });

  it("redacts sensitive metadata", () => {
    const entry = recordUserActivity({
      actor: "user@test.com",
      action: "login",
      metadata: {
        password: "supersecret123",
        note: "token=abc123",
      },
    });
    expect(entry.metadata?.password).toBe("[REDACTED]");
    expect(entry.metadata?.note).toContain("[REDACTED]");
    expect(isSafeActivityEntry(entry)).toBe(true);
  });

  it("filters by action and target", () => {
    recordUserActivity({ actor: "alice@test.com", action: "payment_submit", target: "order-1" });
    recordUserActivity({ actor: "bob@test.com", action: "login" });

    const byAction = queryUserActivity({ action: "payment_submit" });
    expect(byAction.total).toBe(1);

    const byTarget = queryUserActivity({ target: "order-1" });
    expect(byTarget.total).toBe(1);
  });

  it("hashes actor consistently", () => {
    expect(hashActor("User@Example.com")).toBe(hashActor("user@example.com"));
  });
});

describe("userActivity admin route", () => {
  let logDir = "";

  beforeAll(() => {
    process.env.ROUTES_D_ADMIN_TOKEN = "test-admin-token";
  });

  afterAll(() => {
    delete process.env.ROUTES_D_ADMIN_TOKEN;
  });

  beforeEach(() => {
    logDir = setTestLogDir();
    recordUserActivity({ actor: "admin@test.com", action: "admin_action", target: "cfg-1" });
  });

  afterEach(() => {
    cleanup(logDir);
  });

  it("returns 403 without admin token", async () => {
    const res = await GET(new Request("http://localhost/api/routes-d/user-activity"));
    expect(res.status).toBe(403);
  });

  it("returns entries for admin callers", async () => {
    const res = await GET(
      new Request("http://localhost/api/routes-d/user-activity?action=admin_action", {
        headers: { "x-admin-token": "test-admin-token" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.entries[0].action).toBe("admin_action");
  });
});
