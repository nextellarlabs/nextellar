import { jest } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

// audit-log.ts delegates its on/off switch to telemetry.ts's
// getTelemetryStatus(), which derives its config path from os.homedir() at
// import time (see tests/telemetry.test.ts for the same pattern) — redirect
// it to an isolated temp dir so this test never touches the real
// ~/.nextellar/config.json.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nextellar-audit-log-"));

jest.unstable_mockModule("os", () => ({
  default: {
    ...os,
    homedir: () => tmpHome,
  },
  homedir: () => tmpHome,
}));

const { setTelemetryEnabled, getTelemetryStatus } =
  await import("../src/lib/telemetry");
const { recordAuditEvent, auditLogPath } = await import("../src/lib/audit-log");

describe("audit log telemetry opt-out (#1265)", () => {
  const origEnv = { ...process.env };

  beforeEach(async () => {
    await fs.remove(path.join(tmpHome, ".nextellar"));
    process.env = { ...origEnv };
    delete process.env.NEXTELLAR_TELEMETRY_DISABLED;
  });

  afterAll(async () => {
    await fs.remove(tmpHome);
  });

  it("writes no audit-log entries when telemetry has never been enabled (default opt-out)", async () => {
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "nextellar-audit-cwd-"),
    );
    try {
      expect(await getTelemetryStatus()).toBe("disabled");

      await recordAuditEvent(cwd, "add", { wallet: "freighter" });

      expect(await fs.pathExists(auditLogPath(cwd))).toBe(false);
    } finally {
      await fs.remove(cwd);
    }
  });

  it("writes no audit-log entries once telemetry has been explicitly disabled again", async () => {
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "nextellar-audit-cwd-"),
    );
    try {
      await setTelemetryEnabled(true);
      await setTelemetryEnabled(false);

      await recordAuditEvent(cwd, "upgrade", { contract: "demo" });

      expect(await fs.pathExists(auditLogPath(cwd))).toBe(false);
    } finally {
      await fs.remove(cwd);
    }
  });

  it("writes no audit-log entries when NEXTELLAR_TELEMETRY_DISABLED overrides an enabled config", async () => {
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "nextellar-audit-cwd-"),
    );
    try {
      await setTelemetryEnabled(true);
      process.env.NEXTELLAR_TELEMETRY_DISABLED = "1";

      await recordAuditEvent(cwd, "add", {});

      expect(await fs.pathExists(auditLogPath(cwd))).toBe(false);
    } finally {
      await fs.remove(cwd);
    }
  });

  it("still writes a local audit-log entry when telemetry is enabled", async () => {
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "nextellar-audit-cwd-"),
    );
    try {
      await setTelemetryEnabled(true);

      await recordAuditEvent(cwd, "add", { wallet: "freighter" });

      const logPath = auditLogPath(cwd);
      expect(await fs.pathExists(logPath)).toBe(true);
      const contents = await fs.readFile(logPath, "utf8");
      const entry = JSON.parse(contents.trim());
      expect(entry.action).toBe("add");
      expect(entry.wallet).toBe("freighter");
      expect(typeof entry.timestamp).toBe("string");
    } finally {
      await fs.remove(cwd);
    }
  });

  it("opting out after an enabled run stops further entries without deleting the local log", async () => {
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "nextellar-audit-cwd-"),
    );
    try {
      await setTelemetryEnabled(true);
      await recordAuditEvent(cwd, "add", {});

      const logPath = auditLogPath(cwd);
      const before = await fs.readFile(logPath, "utf8");

      await setTelemetryEnabled(false);
      await recordAuditEvent(cwd, "upgrade", {});

      const after = await fs.readFile(logPath, "utf8");
      expect(after).toBe(before);
    } finally {
      await fs.remove(cwd);
    }
  });

  it("never throws even if the opted-out status check itself fails", async () => {
    const cwd = await fs.mkdtemp(
      path.join(os.tmpdir(), "nextellar-audit-cwd-"),
    );
    try {
      // Opted out, and cwd does not exist yet — recordAuditEvent must still
      // resolve without writing anything or throwing (audit logging must
      // never break the add/upgrade commands it instruments).
      await fs.remove(cwd);
      await expect(recordAuditEvent(cwd, "add", {})).resolves.toBeUndefined();
      expect(await fs.pathExists(auditLogPath(cwd))).toBe(false);
    } finally {
      await fs.remove(cwd).catch(() => undefined);
    }
  });
});
