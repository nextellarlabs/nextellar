import path from "path";
import fs from "fs-extra";
import { getTelemetryStatus } from "./telemetry.js";

export type AuditAction = "add" | "upgrade";

export interface AuditLogEntry {
  timestamp: string;
  action: AuditAction;
  [key: string]: unknown;
}

export function auditLogPath(cwd: string): string {
  return path.join(cwd, ".nextellar", "audit.log");
}

/**
 * Appends a local, JSON-Lines audit entry for an `add`/`upgrade` action.
 *
 * The log never leaves the machine, but it shares the same on/off switch as
 * remote telemetry (`nextellar telemetry enable|disable`, `--no-telemetry`,
 * `NEXTELLAR_TELEMETRY_DISABLED`) so users only have one preference to manage.
 * Like telemetry, failures here must never break the CLI command they log.
 */
export async function recordAuditEvent(
  cwd: string,
  action: AuditAction,
  details: Record<string, unknown> = {},
): Promise<void> {
  try {
    if ((await getTelemetryStatus()) !== "enabled") return;

    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      action,
      ...details,
    };

    const logPath = auditLogPath(cwd);
    await fs.ensureDir(path.dirname(logPath));
    await fs.appendFile(logPath, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Audit logging must never block add/upgrade commands.
  }
}
