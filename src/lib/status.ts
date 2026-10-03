import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { getTelemetryStatus, isTelemetryDisabledByEnv } from "./telemetry.js";
import { defaultTemplatesRoot, getTemplate } from "./templates.js";

/**
 * Stellar packages a project's health score cares about staying current on.
 * Mirrors upgrade.ts's STELLAR_PKGS: both compare a project's package.json
 * against the shipped template's for the same set, so the two commands
 * report the same "what's stale" story instead of drifting apart.
 */
const STELLAR_PKGS = [
  "@stellar/stellar-sdk",
  "@creit.tech/stellar-wallets-kit",
];

export type StatusCheckId =
  "project" | "dependencies" | "env" | "telemetry" | "git";

export interface StatusCheck {
  id: StatusCheckId;
  name: string;
  ok: boolean;
  detail: string;
}

export interface StatusReport {
  schemaVersion: number;
  score: number;
  maxScore: number;
  checks: StatusCheck[];
}

export const STATUS_JSON_SCHEMA_VERSION = 1;

/** Parses a `.env`-style file into a set of declared variable names. Ignores comments/blank lines. */
function parseEnvKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

async function checkOutdatedDependencies(
  cwd: string,
  templateName: string,
): Promise<StatusCheck> {
  const templatesRoot = defaultTemplatesRoot();
  const template = getTemplate(templateName);
  const tplDir = template?.tsDir
    ? path.join(templatesRoot, template.tsDir)
    : undefined;

  const projPkgPath = path.join(cwd, "package.json");
  if (!(await fs.pathExists(projPkgPath))) {
    return {
      id: "dependencies",
      name: "Dependencies",
      ok: false,
      detail: "No package.json found.",
    };
  }

  const projPkg = await fs.readJson(projPkgPath).catch(() => ({}));
  const projDeps = {
    ...(projPkg.dependencies || {}),
    ...(projPkg.devDependencies || {}),
  };

  if (!tplDir || !(await fs.pathExists(path.join(tplDir, "package.json")))) {
    // Unknown/unresolvable template: report presence only, no staleness comparison.
    return {
      id: "dependencies",
      name: "Dependencies",
      ok: true,
      detail: `${Object.keys(projDeps).length} dependencies declared (template unavailable for comparison).`,
    };
  }

  const tplPkg = await fs
    .readJson(path.join(tplDir, "package.json"))
    .catch(() => ({}));
  const tplDeps = {
    ...(tplPkg.dependencies || {}),
    ...(tplPkg.devDependencies || {}),
  };

  const stale: string[] = [];
  for (const pkg of STELLAR_PKGS) {
    if (tplDeps[pkg] && projDeps[pkg] && tplDeps[pkg] !== projDeps[pkg]) {
      stale.push(`${pkg} (${projDeps[pkg]} -> ${tplDeps[pkg]})`);
    }
  }

  if (stale.length > 0) {
    return {
      id: "dependencies",
      name: "Dependencies",
      ok: false,
      detail: `Outdated: ${stale.join(", ")}. Run "nextellar upgrade" to update.`,
    };
  }

  return {
    id: "dependencies",
    name: "Dependencies",
    ok: true,
    detail: "Stellar dependencies match the current template.",
  };
}

async function checkEnvVars(cwd: string): Promise<StatusCheck> {
  const examplePath = path.join(cwd, ".env.example");
  if (!(await fs.pathExists(examplePath))) {
    return {
      id: "env",
      name: "Environment variables",
      ok: true,
      detail: "No .env.example present; nothing to check.",
    };
  }

  const exampleKeys = parseEnvKeys(await fs.readFile(examplePath, "utf8"));

  // Merge every .env* file the project might use; a var declared in any of
  // them counts as "present" (mirrors how Next.js layers .env files).
  const envFiles = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
  ];
  const presentKeys = new Set<string>();
  for (const file of envFiles) {
    const filePath = path.join(cwd, file);
    if (await fs.pathExists(filePath)) {
      for (const key of parseEnvKeys(await fs.readFile(filePath, "utf8"))) {
        presentKeys.add(key);
      }
    }
  }

  // Only vars .env.example declares *uncommented with a value placeholder*
  // are meaningfully "required" for this check — parseEnvKeys already
  // skips commented-out optional vars.
  const missing = [...exampleKeys].filter(
    (key) => !presentKeys.has(key) && !(key in process.env),
  );

  if (missing.length > 0) {
    return {
      id: "env",
      name: "Environment variables",
      ok: false,
      detail: `Missing from .env.local: ${missing.join(", ")}`,
    };
  }

  return {
    id: "env",
    name: "Environment variables",
    ok: true,
    detail: `All ${exampleKeys.size} variable(s) from .env.example are set.`,
  };
}

async function checkTelemetry(): Promise<StatusCheck> {
  const status = await getTelemetryStatus();
  const forced = isTelemetryDisabledByEnv();
  return {
    id: "telemetry",
    name: "Telemetry",
    ok: true, // Either state is a valid, healthy configuration.
    detail: forced
      ? "Disabled via NEXTELLAR_TELEMETRY_DISABLED."
      : `${status[0].toUpperCase()}${status.slice(1)}.`,
  };
}

async function checkGitRepo(cwd: string): Promise<StatusCheck> {
  const ok = await fs.pathExists(path.join(cwd, ".git"));
  return {
    id: "git",
    name: "Git repository",
    ok,
    detail: ok ? "Initialized." : "Not a git repository.",
  };
}

export interface StatusOptions {
  cwd?: string;
  json?: boolean;
}

/**
 * Entry point for `nextellar status`: aggregates a scaffolded project's
 * health (dependency staleness, missing env vars, telemetry configuration,
 * git init) into one short report, similar in spirit to `nextellar doctor`
 * but about the *project*, not the local toolchain.
 */
export async function runStatus(opts: StatusOptions = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const configPath = path.join(cwd, ".nextellar", "config.json");

  if (!(await fs.pathExists(configPath))) {
    throw new Error("Not a Nextellar project: missing .nextellar/config.json");
  }

  const projectConfig = await fs.readJson(configPath).catch(() => ({}));
  const templateName = projectConfig.template || "default";

  const checks: StatusCheck[] = [
    {
      id: "project",
      name: "Project",
      ok: true,
      detail: `Template: ${templateName}${projectConfig.nextellarVersion ? ` (scaffolded with v${projectConfig.nextellarVersion})` : ""}`,
    },
    await checkOutdatedDependencies(cwd, templateName),
    await checkEnvVars(cwd),
    await checkTelemetry(),
    await checkGitRepo(cwd),
  ];

  const score = checks.filter((c) => c.ok).length;
  const maxScore = checks.length;

  if (opts.json) {
    const report: StatusReport = {
      schemaVersion: STATUS_JSON_SCHEMA_VERSION,
      score,
      maxScore,
      checks,
    };
    console.log(JSON.stringify(report, null, 2));
    return score === maxScore ? 0 : 1;
  }

  console.log(pc.bold("\nNextellar Project Status\n"));
  for (const c of checks) {
    const mark = c.ok ? pc.green("✔") : pc.yellow("⚠");
    console.log(`${mark} ${pc.bold(c.name.padEnd(24))} ${pc.dim(c.detail)}`);
  }
  console.log("");
  console.log(pc.bold(`Health score: ${score}/${maxScore}`));
  console.log("");

  return score === maxScore ? 0 : 1;
}

export default runStatus;
