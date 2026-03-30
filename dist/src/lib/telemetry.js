import os from "os";
import path from "path";
import fs from "fs-extra";
import crypto from "crypto";
const NEXTELLAR_DIR = path.join(os.homedir(), ".nextellar");
const CONFIG_PATH = path.join(NEXTELLAR_DIR, "config.json");
const DEFAULT_ENDPOINT = "https://nextellar.dev/api/telemetry";
export function isTelemetryDisabledByEnv() {
    const value = process.env.NEXTELLAR_TELEMETRY_DISABLED;
    return value === "1" || value === "true";
}
export async function readTelemetryConfig() {
    try {
        if (!(await fs.pathExists(CONFIG_PATH))) {
            return {};
        }
        const raw = await fs.readJson(CONFIG_PATH);
        if (!raw || typeof raw !== "object") {
            return {};
        }
        return raw;
    }
    catch {
        // Never let config failures break CLI behavior.
        return {};
    }
}
async function writeTelemetryConfig(config) {
    try {
        await fs.ensureDir(NEXTELLAR_DIR);
        await fs.writeJson(CONFIG_PATH, config, { spaces: 2 });
    }
    catch {
        // Silent failure by design.
    }
}
export async function setTelemetryEnabled(enabled) {
    const current = await readTelemetryConfig();
    const anonymousId = current.telemetry?.anonymousId ||
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
export async function getTelemetryStatus() {
    if (isTelemetryDisabledByEnv()) {
        return "disabled";
    }
    const config = await readTelemetryConfig();
    return config.telemetry?.enabled === true ? "enabled" : "disabled";
}
export async function maybeShowTelemetryNotice(options) {
    if (isTelemetryDisabledByEnv() || options?.noTelemetryFlag === true) {
        return;
    }
    const config = await readTelemetryConfig();
    if (config.telemetry?.noticeShown) {
        return;
    }
    console.log("\nNextellar collects anonymous usage data to improve the tool.");
    console.log("You can disable this with --no-telemetry or NEXTELLAR_TELEMETRY_DISABLED=1");
    console.log("Learn more: https://nextellar.dev/telemetry\n");
    await writeTelemetryConfig({
        ...config,
        telemetry: {
            ...config.telemetry,
            noticeShown: true,
            // Opt-in by default is disabled until explicitly enabled.
            enabled: config.telemetry?.enabled ?? false,
            anonymousId: config.telemetry?.anonymousId ||
                (typeof crypto.randomUUID === "function"
                    ? crypto.randomUUID()
                    : crypto.randomBytes(16).toString("hex")),
        },
    });
}
async function getOrCreateAnonymousId() {
    const config = await readTelemetryConfig();
    if (config.telemetry?.enabled !== true) {
        return null;
    }
    if (config.telemetry.anonymousId) {
        return config.telemetry.anonymousId;
    }
    const anonymousId = typeof crypto.randomUUID === "function"
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
function shouldSkipTelemetry(noTelemetryFlag) {
    return isTelemetryDisabledByEnv() || noTelemetryFlag === true;
}
async function postTelemetryEvent(event) {
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
    }
    catch {
        // Silent failure: telemetry should never block scaffolding.
    }
    finally {
        clearTimeout(timeout);
    }
}
export async function trackScaffoldEvent(properties, options) {
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
