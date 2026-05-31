import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type UserActivityAction =
  | "login"
  | "password_change"
  | "payment_submit"
  | "admin_action";

export interface UserActivityEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: UserActivityAction;
  target?: string;
  route?: string;
  metadata?: Record<string, string>;
}

export interface UserActivityQueryFilters {
  startDate?: string;
  endDate?: string;
  actor?: string;
  action?: UserActivityAction;
  target?: string;
  limit?: number;
  offset?: number;
}

export interface UserActivityQueryResult {
  entries: UserActivityEntry[];
  total: number;
  page: number;
  pageSize: number;
}

const LOG_DIR = process.env.USER_ACTIVITY_LOG_DIR || join(process.cwd(), "routes-d", "logs");

function logFilePath(): string {
  const dir = process.env.USER_ACTIVITY_LOG_DIR || LOG_DIR;
  return join(dir, "user-activity.jsonl");
}

function logDirPath(): string {
  return process.env.USER_ACTIVITY_LOG_DIR || LOG_DIR;
}

function ensureLogDir(): void {
  const dir = logDirPath();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readEntries(): UserActivityEntry[] {
  ensureLogDir();
  const file = logFilePath();
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as UserActivityEntry);
}

function appendEntry(entry: UserActivityEntry): void {
  ensureLogDir();
  writeFileSync(logFilePath(), `${JSON.stringify(entry)}\n`, { flag: "a" });
}

export function hashActor(value: string): string {
  const pepper = process.env.USER_ACTIVITY_PEPPER || "nextellar-activity-pepper-dev";
  const normalized = value.trim().toLowerCase();
  return createHash("sha256").update(`${normalized}${pepper}`).digest("hex");
}

function redactValue(value: string): string {
  return value
    .replace(/password[=:]\s*\S+/gi, "password=[REDACTED]")
    .replace(/token[=:]\s*\S+/gi, "token=[REDACTED]")
    .replace(/secret[=:]\s*\S+/gi, "secret=[REDACTED]")
    .replace(/bearer\s+\S+/gi, "bearer [REDACTED]");
}

function sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, string> | undefined {
  if (!metadata) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(metadata)) {
    const lower = key.toLowerCase();
    if (["password", "token", "secret", "privatekey", "creditcard"].includes(lower)) {
      out[key] = "[REDACTED]";
      continue;
    }
    const value = typeof raw === "string" ? redactValue(raw) : JSON.stringify(raw);
    out[key] = value.slice(0, 200);
  }
  return out;
}

export function recordUserActivity(params: {
  actor: string;
  action: UserActivityAction;
  target?: string;
  route?: string;
  metadata?: Record<string, unknown>;
}): UserActivityEntry {
  const entry: UserActivityEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actor: hashActor(params.actor.trim().toLowerCase()),
    action: params.action,
    target: params.target ? hashActor(params.target.trim().toLowerCase()) : undefined,
    route: params.route,
    metadata: sanitizeMetadata(params.metadata),
  };
  appendEntry(entry);
  return entry;
}

export function queryUserActivity(filters: UserActivityQueryFilters = {}): UserActivityQueryResult {
  let entries = readEntries();

  if (filters.startDate) {
    entries = entries.filter((entry) => entry.timestamp >= filters.startDate!);
  }
  if (filters.endDate) {
    entries = entries.filter((entry) => entry.timestamp <= filters.endDate!);
  }
  if (filters.actor) {
    const actorHash = hashActor(filters.actor);
    entries = entries.filter((entry) => entry.actor === actorHash);
  }
  if (filters.action) {
    entries = entries.filter((entry) => entry.action === filters.action);
  }
  if (filters.target) {
    const targetHash = hashActor(filters.target);
    entries = entries.filter((entry) => entry.target === targetHash);
  }

  const total = entries.length;
  const pageSize = Math.min(filters.limit ?? 50, 100);
  const page = Math.max(filters.offset ?? 0, 0);
  const paginated = entries.slice(page * pageSize, (page + 1) * pageSize);

  return {
    entries: paginated,
    total,
    page,
    pageSize,
  };
}

export function isSafeActivityEntry(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) {
    return false;
  }
  const value = entry as Record<string, unknown>;
  const forbidden = ["password", "rawToken", "fullToken", "secret", "privateKey"];
  for (const field of forbidden) {
    if (field in value) {
      return false;
    }
  }
  if (typeof value.actor !== "string" || !/^[a-f0-9]{64}$/.test(value.actor)) {
    return false;
  }
  if (value.metadata && typeof value.metadata === "object") {
    for (const meta of Object.values(value.metadata as Record<string, unknown>)) {
      if (typeof meta === "string" && /supersecret|password123/i.test(meta)) {
        return false;
      }
    }
  }
  return true;
}
