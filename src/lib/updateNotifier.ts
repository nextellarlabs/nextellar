import os from "os";
import path from "path";
import fs from "fs-extra";
import pc from "picocolors";

// A function, not a module-load-time constant: tests need to point this at
// a temp directory, and re-reading os.homedir() per call costs nothing on
// the once-a-day cold path this guards.
function getUpdateCheckStatePath(): string {
  const base = process.env.NEXTELLAR_HOME_OVERRIDE || os.homedir();
  return path.join(base, ".nextellar", "update-check.json");
}

const REGISTRY_URL = "https://registry.npmjs.org/nextellar/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day
const REQUEST_TIMEOUT_MS = 1500;

interface UpdateCheckState {
  lastCheckedAt?: number;
  latestKnownVersion?: string;
}

async function readState(): Promise<UpdateCheckState> {
  const statePath = getUpdateCheckStatePath();
  try {
    if (!(await fs.pathExists(statePath))) {
      return {};
    }
    const raw = await fs.readJson(statePath);
    if (!raw || typeof raw !== "object") return {};
    return raw as UpdateCheckState;
  } catch {
    // A corrupted or unreadable cache must never block the CLI.
    return {};
  }
}

async function writeState(state: UpdateCheckState): Promise<void> {
  const statePath = getUpdateCheckStatePath();
  try {
    await fs.ensureDir(path.dirname(statePath));
    await fs.writeJson(statePath, state, { spaces: 2 });
  } catch {
    // Silent failure by design, matching telemetry.ts's config persistence.
  }
}

/**
 * Compares two "x.y.z" version strings. Returns true if `latest` is strictly
 * newer than `current`. Deliberately simple (no pre-release/build metadata
 * handling) since the registry's "latest" dist-tag is always a plain
 * release version.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string) => v.split(".").map((part) => parseInt(part, 10) || 0);
  const a = parse(current);
  const b = parse(latest);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (y > x) return true;
    if (y < x) return false;
  }
  return false;
}

async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const data: any = await res.json();
    return typeof data?.version === "string" ? data.version : null;
  } catch {
    // Offline, DNS failure, timeout, registry outage, malformed JSON: all
    // fail silently. An update notice is a courtesy, never a hard
    // dependency of the command the user actually ran.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export interface UpdateNotifierOptions {
  currentVersion: string;
  /** True when --no-telemetry was passed for this invocation. */
  noTelemetryFlag?: boolean;
}

/**
 * Prints a one-line notice when a newer version of the nextellar CLI is
 * available on npm. Rate-limited to once per CHECK_INTERVAL_MS via a cached
 * timestamp in ~/.nextellar/update-check.json, so a normal run never waits
 * on a fresh network request. Fails silently offline or when telemetry is
 * disabled: an update notice is not essential CLI behavior, and users who
 * opted out of network calls should see none.
 */
export async function maybeNotifyUpdate(options: UpdateNotifierOptions): Promise<void> {
  const { currentVersion, noTelemetryFlag } = options;

  if (
    noTelemetryFlag ||
    process.env.NEXTELLAR_TELEMETRY_DISABLED ||
    process.env.NEXTELLAR_NO_UPDATE_NOTIFIER ||
    process.env.CI
  ) {
    return;
  }

  const state = await readState();
  const now = Date.now();
  const isCacheFresh =
    typeof state.lastCheckedAt === "number" && now - state.lastCheckedAt < CHECK_INTERVAL_MS;

  let latestVersion = isCacheFresh ? state.latestKnownVersion : undefined;

  if (!isCacheFresh) {
    const fetched = await fetchLatestVersion();
    if (fetched) {
      latestVersion = fetched;
      await writeState({ lastCheckedAt: now, latestKnownVersion: fetched });
    } else {
      // Still record the attempt so a flaky/offline network doesn't cause a
      // fresh request on every single invocation.
      await writeState({ ...state, lastCheckedAt: now });
    }
  }

  if (latestVersion && isNewerVersion(currentVersion, latestVersion)) {
    console.log(
      pc.yellow(
        `\nA new version of nextellar is available: ${pc.dim(currentVersion)} → ${pc.green(latestVersion)}`,
      ),
    );
    console.log(pc.dim("  Run `npm install -g nextellar` to update.\n"));
  }
}
