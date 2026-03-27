import { exec as execCb } from "child_process";
import util from "util";
import os from "os";
import pc from "picocolors";

const exec = util.promisify(execCb) as (
  cmd: string,
  opts?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

type CheckResult = {
  id: string;
  name: string;
  required: boolean;
  ok: boolean;
  detail?: string;
  fix?: string;
  link?: string;
};

const HORIZON = "https://horizon-testnet.stellar.org";
const SOROBAN = "https://soroban-testnet.stellar.org";

function parseVersion(raw: string) {
  return raw.trim().replace(/^v/, "");
}

function satisfiesMinVersion(v: string, minMajor: number) {
  const major = parseInt(v.split(".")[0], 10) || 0;
  return major >= minMajor;
}

async function runCommand(cmd: string, timeout = 5000) {
  try {
    const { stdout } = await exec(cmd, { timeout });
    return { ok: true, out: stdout.trim() };
  } catch (err: any) {
    return { ok: false, out: String(err?.message || err) };
  }
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
  };
}

async function checkHorizon(): Promise<CheckResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(HORIZON, { method: "HEAD", signal: controller.signal });
    clearTimeout(timeout);
    return {
      id: "horizon",
      name: "Horizon API",
      required: true,
      ok: res.ok,
      detail: `${HORIZON} (${res.status})`,
      fix: "Check network or use --horizon-url to override",
      link: HORIZON,
    };
  } catch (err: any) {
    return {
      id: "horizon",
      name: "Horizon API",
      required: true,
      ok: false,
      detail: `Unreachable: ${String(err.message || err)}`,
      fix: "Ensure network access to horizon-testnet.stellar.org",
      link: HORIZON,
    };
  }
}

async function checkSoroban(): Promise<CheckResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(SOROBAN, {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "status", params: [] }),
      headers: { "content-type": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return {
      id: "soroban",
      name: "Soroban RPC",
      required: false,
      ok: res.ok,
      detail: `${SOROBAN} (${res.status})`,
      fix: "Check network or use --soroban-url to override",
      link: SOROBAN,
    };
  } catch (err: any) {
    return {
      id: "soroban",
      name: "Soroban RPC",
      required: false,
      ok: false,
      detail: `Unreachable: ${String(err.message || err)}`,
      fix: "Ensure network access to soroban-testnet.stellar.org",
      link: SOROBAN,
    };
  }
}

async function checkDisk(): Promise<CheckResult> {
  const free = os.freemem();
  const ok = free > 1_000_000_000; // > 1GB
  return {
    id: "disk",
    name: "Disk / Memory",
    required: true,
    ok,
    detail: ok ? `${Math.round(free / (1024 * 1024))} MB free` : `${Math.round(free / (1024 * 1024))} MB free`,
    fix: "Free up at least 1GB of memory/disk space",
  };
}

export async function runDoctor(opts?: { json?: boolean }) {
  const json = !!opts?.json;

  const checks = await Promise.all([
    checkNode(),
    checkNpm(),
    checkYarn(),
    checkPnpm(),
    checkGit(),
    checkRustc(),
    checkStellarCli(),
    checkWasmTarget(),
    checkHorizon(),
    checkSoroban(),
    checkDisk(),
  ]);

  const requiredFailures = checks.filter((c) => c.required && !c.ok).length;
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;

  if (json) {
    const out = { checks, passed, failed, requiredFailures };
    console.log(JSON.stringify(out, null, 2));
    return requiredFailures > 0 ? 1 : 0;
  }

  console.log(pc.bold("\nNextellar Doctor\n"));
  for (const c of checks) {
    const mark = c.ok ? pc.green("✔") : c.required ? pc.red("✖") : pc.yellow("⚠");
    const name = pc.bold(c.name.padEnd(16));
    const detail = c.detail ? ` ${pc.dim(c.detail)}` : "";
    console.log(`${mark} ${name}${detail}`);
    if (!c.ok && c.fix) {
      console.log(`   ${pc.dim(c.fix)}`);
    }
  }

  console.log("");
  console.log(`${passed} checks passed, ${failed} checks failed` + (requiredFailures > 0 ? ` (${requiredFailures} required failed)` : ""));
  console.log("");

  return requiredFailures > 0 ? 1 : 0;
}

export default runDoctor;