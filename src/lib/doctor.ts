import { exec as execCb } from "child_process";
import { createRequire } from "module";
import util from "util";
import os from "os";
import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { confirm, isCancel } from "@clack/prompts";

const exec = util.promisify(execCb) as (
  cmd: string,
  opts?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

export type CheckResult = {
  id: string;
  name: string;
  required: boolean;
  ok: boolean;
  detail?: string;
  fix?: string;
  fixCommand?: string;
  link?: string;
};

export type DoctorOutput = {
  schemaVersion: number;
  horizonUrl: string;
  sorobanUrl: string;
  checks: CheckResult[];
  passed: number;
  failed: number;
  requiredFailures: number;
};

const DEFAULT_HORIZON = "https://horizon-testnet.stellar.org";
const DEFAULT_SOROBAN = "https://soroban-testnet.stellar.org";

// Accept only well-formed http(s) URLs from flags/config so a malformed value
// fails fast with a clear message instead of crashing a check's error path.
function assertValidUrl(url: string, flag: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid ${flag}: "${url}" is not a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid ${flag}: "${url}" must use http or https.`);
  }
}

// Safely extract a host for messaging; never throws on already-validated input,
// and degrades gracefully if somehow given a non-URL.
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function resolveUrls(
  horizonUrl?: string,
  sorobanUrl?: string,
): { horizonUrl: string; sorobanUrl: string } {
  if (horizonUrl) assertValidUrl(horizonUrl, "--horizon-url");
  if (sorobanUrl) assertValidUrl(sorobanUrl, "--soroban-url");

  if (horizonUrl && sorobanUrl) {
    return { horizonUrl, sorobanUrl };
  }

  const configPath = path.join(process.cwd(), ".nextellar", "config.json");
  let configHorizon: string | undefined;
  let configSoroban: string | undefined;
  if (fs.existsSync(configPath)) {
    try {
      const config = fs.readJsonSync(configPath);
      if (typeof config.horizonUrl === "string" && config.horizonUrl.trim()) {
        configHorizon = config.horizonUrl.trim();
      }
      if (typeof config.sorobanUrl === "string" && config.sorobanUrl.trim()) {
        configSoroban = config.sorobanUrl.trim();
      }
    } catch {
      // ignore corrupt config
    }
  }

  return {
    horizonUrl: horizonUrl || configHorizon || DEFAULT_HORIZON,
    sorobanUrl: sorobanUrl || configSoroban || DEFAULT_SOROBAN,
  };
}

function parseVersion(raw: string) {
  return raw.trim().replace(/^v/, "");
}

function satisfiesMinVersion(v: string, minMajor: number) {
  const major = parseInt(v.split(".")[0], 10) || 0;
  return major >= minMajor;
}

export type CommandRunner = (
  cmd: string,
  timeout?: number,
) => Promise<{ ok: boolean; out: string }>;

async function defaultCommandRunner(cmd: string, timeout = 5000) {
  try {
    const { stdout } = await exec(cmd, { timeout });
    return { ok: true, out: stdout.trim() };
  } catch (err: any) {
    return { ok: false, out: String(err?.message || err) };
  }
}

let commandRunner: CommandRunner = defaultCommandRunner;

/**
 * Test-only seam (#639): substitutes the runner every tool check (node,
 * npm, yarn, pnpm, git, rustc, stellar CLI, wasm32 target) goes through,
 * so tests can force each check to pass/fail deterministically without
 * spawning a real subprocess. Pass `undefined` to restore the real,
 * subprocess-spawning runner.
 */
export function setCommandRunnerForTest(
  runner: CommandRunner | undefined,
): void {
  commandRunner = runner ?? defaultCommandRunner;
}

async function runCommand(cmd: string, timeout = 5000) {
  return commandRunner(cmd, timeout);
}

async function checkNode(): Promise<CheckResult> {
  // Use process.version as authoritative, but also try `node --version`
  const procVer = parseVersion(process.version || "");
  const cmd = await runCommand("node --version", 3000);
  const used = cmd.ok ? parseVersion(cmd.out) : procVer;
  const ok = satisfiesMinVersion(used, 20);
  return {
    id: "node",
    name: "Node.js",
    required: true,
    ok,
    detail: ok ? `v${used} (>= 20.0.0 required)` : `v${used || "unknown"}`,
    fix: "Install Node.js >= 20: https://nodejs.org/",
    link: "https://nodejs.org/",
  };
}

async function checkNpm(): Promise<CheckResult> {
  const res = await runCommand("npm --version", 3000);
  const ok = res.ok && res.out.length > 0;
  return {
    id: "npm",
    name: "npm",
    required: true,
    ok,
    detail: ok ? `v${res.out}` : "Not installed",
    fix: "npm comes with Node.js. Install Node: https://nodejs.org/",
  };
}

async function checkYarn(): Promise<CheckResult> {
  const res = await runCommand("yarn --version", 2000);
  const ok = res.ok && res.out.length > 0;
  return {
    id: "yarn",
    name: "yarn",
    required: false,
    ok,
    detail: ok ? `v${res.out}` : "Not installed",
    fix: "Install: npm install -g yarn",
    fixCommand: "npm install -g yarn",
  };
}

async function checkPnpm(): Promise<CheckResult> {
  const res = await runCommand("pnpm --version", 2000);
  const ok = res.ok && res.out.length > 0;
  return {
    id: "pnpm",
    name: "pnpm",
    required: false,
    ok,
    detail: ok ? `v${res.out}` : "Not installed",
    fix: "Install: npm install -g pnpm",
    fixCommand: "npm install -g pnpm",
  };
}

async function checkGit(): Promise<CheckResult> {
  const res = await runCommand("git --version", 3000);
  const ok = res.ok && res.out.length > 0;
  return {
    id: "git",
    name: "Git",
    required: true,
    ok,
    detail: ok ? res.out.replace(/^git version /, "v") : "Not installed",
    fix: "Install: https://git-scm.com/downloads",
    link: "https://git-scm.com/downloads",
  };
}

async function checkRustc(): Promise<CheckResult> {
  const res = await runCommand("rustc --version", 3000);
  const ok = res.ok && res.out.length > 0;
  return {
    id: "rustc",
    name: "Rust",
    required: false,
    ok,
    detail: ok ? res.out : "Not installed (needed for contract development)",
    fix: "Install: https://rustup.rs",
    link: "https://rustup.rs",
  };
}

async function checkStellarCli(): Promise<CheckResult> {
  const res = await runCommand("stellar --version", 3000);
  const ok = res.ok && res.out.length > 0;
  return {
    id: "stellar-cli",
    name: "Stellar CLI",
    required: false,
    ok,
    detail: ok ? res.out : "Not installed (needed for contract development)",
    fix: "Install: cargo install stellar-cli",
    fixCommand: "cargo install stellar-cli",
  };
}

async function checkWasmTarget(): Promise<CheckResult> {
  const res = await runCommand("rustup target list --installed", 3000);
  const ok = res.ok && res.out.includes("wasm32-unknown-unknown");
  return {
    id: "wasm32",
    name: "wasm32 target",
    required: false,
    ok,
    detail: ok ? "wasm32-unknown-unknown installed" : "Not installed",
    fix: "Install: rustup target add wasm32-unknown-unknown",
    fixCommand: "rustup target add wasm32-unknown-unknown",
  };
}

export type PackageResolver = (specifier: string) => boolean;

function defaultPackageResolver(specifier: string): boolean {
  try {
    const require = createRequire(path.join(process.cwd(), "package.json"));
    require.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

let packageResolver: PackageResolver = defaultPackageResolver;

/**
 * Test-only seam (#1279): substitutes how checkWalletAdapterSdks()
 * resolves peer packages, so tests can simulate an installed/missing SDK
 * without a real node_modules tree. Pass `undefined` to restore the real,
 * require.resolve-based resolver.
 */
export function setPackageResolverForTest(
  resolver: PackageResolver | undefined,
): void {
  packageResolver = resolver ?? defaultPackageResolver;
}

function configuredWallets(): string[] {
  const configPath = path.join(process.cwd(), ".nextellar", "config.json");
  if (!fs.existsSync(configPath)) return [];
  try {
    const config = fs.readJsonSync(configPath);
    return Array.isArray(config.wallets) ? config.wallets : [];
  } catch {
    return [];
  }
}

/**
 * Verifies the Ledger/WalletConnect wallet-adapter peer dependencies are
 * installed when the project's `.nextellar/config.json` lists those wallets
 * (issue #1279). `nextellar doctor` otherwise has no visibility into
 * these: both are lazy-loaded only when the user actually picks that wallet
 * (see stellar-wallet-kit.ts), so a missing/incompatible SDK would
 * otherwise surface as a runtime import error deep in the wallet flow
 * instead of a clear, upfront diagnostic.
 */
async function checkWalletAdapterSdks(): Promise<CheckResult> {
  const wallets = configuredWallets();
  const wantsLedger = wallets.includes("ledger");
  const wantsWalletConnect = wallets.includes("walletconnect");

  if (!wantsLedger && !wantsWalletConnect) {
    return {
      id: "wallet-adapter-sdks",
      name: "Wallet adapter SDKs",
      required: false,
      ok: true,
      detail:
        "Not configured (no ledger/walletconnect in .nextellar/config.json)",
    };
  }

  // npm-installable specifiers (feed `npm install` for the fix command)
  // vs. a human-readable label for a dep that can't be fixed by installing
  // a single package (the walletconnect module ships inside the kit itself,
  // so a missing resolve there means an incompatible/corrupt kit install,
  // not a separate package to add).
  const missingInstallable: string[] = [];
  const missingLabels: string[] = [];

  if (wantsLedger) {
    for (const pkg of [
      "@ledgerhq/hw-transport-webusb",
      "@ledgerhq/hw-app-str",
    ]) {
      if (!packageResolver(pkg)) {
        missingInstallable.push(pkg);
        missingLabels.push(pkg);
      }
    }
  }
  if (wantsWalletConnect) {
    if (
      !packageResolver(
        "@creit.tech/stellar-wallets-kit/modules/walletconnect.module",
      )
    ) {
      missingLabels.push(
        "@creit.tech/stellar-wallets-kit (walletconnect module)",
      );
    }
  }

  const ok = missingLabels.length === 0;
  const configured = [
    wantsLedger ? "ledger" : null,
    wantsWalletConnect ? "walletconnect" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    id: "wallet-adapter-sdks",
    name: "Wallet adapter SDKs",
    required: false,
    ok,
    detail: ok
      ? `${configured} dependencies installed`
      : `Missing for ${configured}: ${missingLabels.join(", ")}`,
    fix: ok
      ? undefined
      : missingInstallable.length > 0
        ? `Install: npm install ${missingInstallable.join(" ")}`
        : "Reinstall @creit.tech/stellar-wallets-kit",
    fixCommand:
      !ok && missingInstallable.length === missingLabels.length
        ? `npm install ${missingInstallable.join(" ")}`
        : undefined,
    link: "https://github.com/Creit-Tech/Stellar-Wallets-Kit",
  };
}

async function checkHorizon(horizonUrl: string): Promise<CheckResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(horizonUrl, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return {
      id: "horizon",
      name: "Horizon API",
      required: true,
      ok: res.ok,
      detail: `${horizonUrl} (${res.status})`,
      fix: "Check network or use --horizon-url to override",
      link: horizonUrl,
    };
  } catch (err: any) {
    return {
      id: "horizon",
      name: "Horizon API",
      required: true,
      ok: false,
      detail: `Unreachable: ${String(err.message || err)}`,
      fix: `Ensure network access to ${safeHost(horizonUrl)}`,
      link: horizonUrl,
    };
  }
}

async function checkSoroban(sorobanUrl: string): Promise<CheckResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(sorobanUrl, {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "status",
        params: [],
      }),
      headers: { "content-type": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return {
      id: "soroban",
      name: "Soroban RPC",
      required: false,
      ok: res.ok,
      detail: `${sorobanUrl} (${res.status})`,
      fix: "Check network or use --soroban-url to override",
      link: sorobanUrl,
    };
  } catch (err: any) {
    return {
      id: "soroban",
      name: "Soroban RPC",
      required: false,
      ok: false,
      detail: `Unreachable: ${String(err.message || err)}`,
      fix: `Ensure network access to ${safeHost(sorobanUrl)}`,
      link: sorobanUrl,
    };
  }
}

let freeMemoryProvider: () => number = () => os.freemem();

/**
 * Test-only seam (#639): the disk/RAM check reads real free memory, which
 * makes its result depend on whatever else is running on the machine at
 * test time — flaky in exactly the same way an unmocked subprocess call
 * would be. Pass `undefined` to restore the real os.freemem()-based check.
 */
export function setFreeMemoryProviderForTest(
  provider: (() => number) | undefined,
): void {
  freeMemoryProvider = provider ?? (() => os.freemem());
}

async function checkDisk(): Promise<CheckResult> {
  const free = freeMemoryProvider();
  const ok = free > 1_000_000_000; // > 1GB
  return {
    id: "disk",
    name: "Free Memory (RAM)",
    required: true,
    ok,
    detail: ok
      ? `${Math.round(free / (1024 * 1024))} MB RAM free`
      : `${Math.round(free / (1024 * 1024))} MB RAM free`,
    fix: "Free up at least 1GB of RAM",
  };
}

// v2 adds the resolved `horizonUrl` and `sorobanUrl` top-level fields (#668).
export const DOCTOR_JSON_SCHEMA_VERSION = 2;

export type DoctorOptions = {
  json?: boolean;
  fix?: boolean;
  horizonUrl?: string;
  sorobanUrl?: string;
};

/**
 * Apply a fix command for a failed check.
 * Returns true if the fix was applied successfully, false otherwise.
 */
async function applyFix(check: CheckResult): Promise<boolean> {
  if (!check.fixCommand) {
    return false;
  }

  console.log(
    `\n${pc.dim(`Running fix for ${check.name}:`)} ${pc.cyan(check.fixCommand)}`,
  );

  try {
    const { stdout, stderr } = await exec(check.fixCommand, {
      timeout: 120000,
    });
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    return true;
  } catch (err: any) {
    console.error(pc.red(`Fix failed: ${err?.message || err}`));
    return false;
  }
}

/**
 * Check if a fix is safe to auto-apply.
 * Safe fixes are optional checks with a known fix command.
 */
function isSafeFix(check: CheckResult): boolean {
  return !check.required && !!check.fixCommand;
}

export async function runDoctor(opts?: DoctorOptions) {
  const json = !!opts?.json;
  const fix = !!opts?.fix;
  const { horizonUrl, sorobanUrl } = resolveUrls(
    opts?.horizonUrl,
    opts?.sorobanUrl,
  );

  let checks = await Promise.all([
    checkNode(),
    checkNpm(),
    checkYarn(),
    checkPnpm(),
    checkGit(),
    checkRustc(),
    checkStellarCli(),
    checkWasmTarget(),
    checkWalletAdapterSdks(),
    checkHorizon(horizonUrl),
    checkSoroban(sorobanUrl),
    checkDisk(),
  ]);

  // If --fix is enabled and not in JSON mode, offer to fix safe failures
  if (fix && !json) {
    const safeFixes = checks.filter((c) => !c.ok && isSafeFix(c));

    if (safeFixes.length > 0) {
      console.log(pc.bold("\nSafe auto-fixes available:"));
      for (const check of safeFixes) {
        console.log(
          `  ${pc.yellow("⚠")} ${pc.bold(check.name)}: ${pc.dim(check.fix || "")}`,
        );
      }

      const shouldFix = await confirm({
        message: `Apply ${safeFixes.length} safe fix${safeFixes.length > 1 ? "es" : ""}?`,
        initialValue: true,
      });

      if (isCancel(shouldFix)) {
        console.log(pc.dim("\nFix cancelled."));
      } else if (shouldFix) {
        let fixedCount = 0;
        for (const check of safeFixes) {
          const success = await applyFix(check);
          if (success) {
            fixedCount++;
          }
        }

        if (fixedCount > 0) {
          console.log(
            pc.green(
              `\n${fixedCount} fix${fixedCount > 1 ? "es" : ""} applied. Re-running checks...\n`,
            ),
          );
          // Re-run all checks to verify fixes
          checks = await Promise.all([
            checkNode(),
            checkNpm(),
            checkYarn(),
            checkPnpm(),
            checkGit(),
            checkRustc(),
            checkStellarCli(),
            checkWasmTarget(),
            checkWalletAdapterSdks(),
            checkHorizon(horizonUrl),
            checkSoroban(sorobanUrl),
            checkDisk(),
          ]);
        }
      }
    }
  }

  const requiredFailures = checks.filter((c) => c.required && !c.ok).length;
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;

  if (json) {
    const out: DoctorOutput = {
      schemaVersion: DOCTOR_JSON_SCHEMA_VERSION,
      horizonUrl,
      sorobanUrl,
      // fixCommand is an internal detail used to drive `--fix`'s prompt/exec
      // flow; it's not part of the public --json schema, so strip it here.
      checks: checks.map(
        ({ fixCommand: _fixCommand, ...publicCheck }) => publicCheck,
      ),
      passed,
      failed,
      requiredFailures,
    };
    console.log(JSON.stringify(out, null, 2));
    return requiredFailures > 0 ? 1 : 0;
  }

  console.log(pc.bold("\nNextellar Doctor\n"));
  console.log(`  ${pc.dim("Horizon:" + " ".repeat(8))}${horizonUrl}`);
  console.log(`  ${pc.dim("Soroban:" + " ".repeat(8))}${sorobanUrl}`);
  console.log("");
  for (const c of checks) {
    const mark = c.ok
      ? pc.green("✔")
      : c.required
        ? pc.red("✖")
        : pc.yellow("⚠");
    const name = pc.bold(c.name.padEnd(16));
    const detail = c.detail ? ` ${pc.dim(c.detail)}` : "";
    console.log(`${mark} ${name}${detail}`);
    if (!c.ok && c.fix) {
      console.log(`   ${pc.dim(c.fix)}`);
    }
  }

  console.log("");
  console.log(
    `${passed} checks passed, ${failed} checks failed` +
      (requiredFailures > 0 ? ` (${requiredFailures} required failed)` : ""),
  );
  console.log("");

  return requiredFailures > 0 ? 1 : 0;
}

export default runDoctor;
