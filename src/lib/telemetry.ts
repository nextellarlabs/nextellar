import os from "os";
import path from "path";
import fs from "fs-extra";
import crypto from "crypto";

const NEXTELLAR_DIR = path.join(os.homedir(), ".nextellar");
const CONFIG_PATH = path.join(NEXTELLAR_DIR, "config.json");
const DEFAULT_ENDPOINT = "https://nextellar.dev/api/telemetry";

interface TelemetryConfig {
  telemetry?: {
    enabled?: boolean;
    anonymousId?: string;
    noticeShown?: boolean;
  };
}

export interface ScaffoldTelemetryProperties {
  template: string;
  language: "typescript" | "javascript";
  network: "testnet" | "public";
  wallets: string[];
  packageManager: "npm" | "yarn" | "pnpm";
  withContracts: boolean;
  skipInstall: boolean;
  success: boolean;
  cliVersion: string;
  nodeVersion: string;
  os: string;
}

interface TelemetryEvent {
  event: "scaffold";
  anonymousId: string;
  properties: ScaffoldTelemetryProperties;
}

export function isTelemetryDisabledByEnv(): boolean {
  const value = process.env.NEXTELLAR_TELEMETRY_DISABLED;
  return value === "1" || value === "true";
}

export async function readTelemetryConfig(): Promise<TelemetryConfig> {
  try {
    if (!(await fs.pathExists(CONFIG_PATH))) {
      return {};
    }
    const raw = await fs.readJson(CONFIG_PATH);
    if (!raw || typeof raw !== "object") {
      return {};
    }
    return raw as TelemetryConfig;
  } catch {
    // Never let config failures break CLI behavior.
    return {};
  }
}

async function writeTelemetryConfig(config: TelemetryConfig): Promise<void> {
  try {
    await fs.ensureDir(NEXTELLAR_DIR);
    await fs.writeJson(CONFIG_PATH, config, { spaces: 2 });
  } catch {
    // Silent failure by design.
  }
}

export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  const current = await readTelemetryConfig();
  const anonymousId =
    current.telemetry?.anonymousId ||
    (typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString("hex"));

  await writeTelemetryConfig({
    ...current,
    telemetry: {
      ...current.telemetry,
      enabled,
      anonymousId,
      noticeShown: true,
    },
  });
}

export async function getTelemetryStatus(): Promise<"enabled" | "disabled"> {
  if (isTelemetryDisabledByEnv()) {
    return "disabled";
  }
  const config = await readTelemetryConfig();
  return config.telemetry?.enabled === true ? "enabled" : "disabled";
}

export async function maybeShowTelemetryNotice(options?: {
  noTelemetryFlag?: boolean;
}): Promise<void> {
  if (isTelemetryDisabledByEnv() || options?.noTelemetryFlag === true) {
    return;
  }

  const config = await readTelemetryConfig();
  if (config.telemetry?.noticeShown) {
    return;
  }

  console.log("\nNextellar collects anonymous usage data to improve the tool.");
  console.log(
    "You can disable this with --no-telemetry or NEXTELLAR_TELEMETRY_DISABLED=1"
  );
  console.log("Learn more: https://nextellar.dev/telemetry\n");

  await writeTelemetryConfig({
    ...config,
    telemetry: {
      ...config.telemetry,
      noticeShown: true,
      // Opt-in by default is disabled until explicitly enabled.
      enabled: config.telemetry?.enabled ?? false,
      anonymousId:
        config.telemetry?.anonymousId ||
        (typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : crypto.randomBytes(16).toString("hex")),
    },
  });
}

async function getOrCreateAnonymousId(): Promise<string | null> {
  const config = await readTelemetryConfig();
  if (config.telemetry?.enabled !== true) {
    return null;
  }

  if (config.telemetry.anonymousId) {
    return config.telemetry.anonymousId;
  }

  const anonymousId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString("hex");

  await writeTelemetryConfig({
    ...config,
    telemetry: {
      ...config.telemetry,
      anonymousId,
    },
  });

  return anonymousId;
}

function shouldSkipTelemetry(noTelemetryFlag?: boolean): boolean {
  return isTelemetryDisabledByEnv() || noTelemetryFlag === true;
}

async function postTelemetryEvent(event: TelemetryEvent): Promise<void> {
  const endpoint = process.env.NEXTELLAR_TELEMETRY_ENDPOINT || DEFAULT_ENDPOINT;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
  } catch {
    // Silent failure: telemetry should never block scaffolding.
  } finally {
    clearTimeout(timeout);
  }
}

export async function trackScaffoldEvent(
  properties: ScaffoldTelemetryProperties,
  options?: { noTelemetryFlag?: boolean }
): Promise<void> {
  if (shouldSkipTelemetry(options?.noTelemetryFlag)) {
    return;
  }

  const config = await readTelemetryConfig();
  if (config.telemetry?.enabled !== true) {
    return;
  }

  const anonymousId = await getOrCreateAnonymousId();
  if (!anonymousId) {
    return;
  }

  void postTelemetryEvent({
    event: "scaffold",
    anonymousId,
    properties,
  });
}

export const telemetryConfigPath = CONFIG_PATH;
