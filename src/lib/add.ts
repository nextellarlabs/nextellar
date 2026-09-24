import path from "path";
import fs from "fs-extra";
import { fileURLToPath } from "url";
import { execa } from "execa";
import pc from "picocolors";
import ora from "ora";
import {
  getFeature,
  resolveFeatureWithDeps,
  type FeatureDef,
} from "./features.js";
import { detectPackageManager } from "./install.js";
import { printError } from "./feedback.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AddOptions {
  /** Project root (default: process.cwd()) */
  cwd?: string;
  /** Overwrite existing files */
  force?: boolean;
  /** Skip npm install */
  skipInstall?: boolean;
  /** Package manager override */
  packageManager?: string;
}

export const DEFAULT_TEMPLATE = "default";

/**
 * Resolve a named template directory, or null when it isn't bundled.
 */
function findTemplateDir(templateName: string): string | null {
  const base = path.resolve(__dirname, "..");
  const fromSrc = path.resolve(base, "templates", templateName);
  const fromDist = path.resolve(__dirname, "../../../src/templates", templateName);
  if (fs.existsSync(fromSrc)) return fromSrc;
  if (fs.existsSync(fromDist)) return fromDist;
  return null;
}

/**
 * Resolve the default template directory (TypeScript template).
 */
function getDefaultTemplateDir(): string {
  const dir = findTemplateDir(DEFAULT_TEMPLATE);
  if (!dir) throw new Error("Nextellar default template not found.");
  return dir;
}

export interface ResolvedTemplate {
  /** Template recorded in .nextellar/config.json (or "default" when absent) */
  name: string;
  /** Directory the feature files are read from first */
  dir: string;
  /** Default template dir, used when a file is missing from `dir` */
  defaultDir: string;
}

/**
 * Read the project's template from .nextellar/config.json, the same marker
 * `nextellar upgrade` uses. Pre-1.1 projects (and hand-made ones) have no
 * config, so they fall back to the default template.
 */
export async function resolveProjectTemplate(
  cwd: string
): Promise<ResolvedTemplate> {
  const defaultDir = getDefaultTemplateDir();
  const configPath = path.join(cwd, ".nextellar", "config.json");

  let name = DEFAULT_TEMPLATE;
  if (await fs.pathExists(configPath)) {
    const config = await fs.readJson(configPath).catch(() => ({}));
    if (typeof config.template === "string" && config.template.trim()) {
      name = config.template.trim();
    }
  }

  if (name === DEFAULT_TEMPLATE) return { name, dir: defaultDir, defaultDir };

  const dir = findTemplateDir(name);
  if (!dir) {
    // Config names a template this CLI version doesn't ship — treat it as default.
    return { name: DEFAULT_TEMPLATE, dir: defaultDir, defaultDir };
  }
  return { name, dir, defaultDir };
}

/**
 * Install npm packages in the project. Uses add/install depending on package manager.
 */
async function installPackages(
  cwd: string,
  packages: string[],
  packageManager?: string
): Promise<boolean> {
  if (packages.length === 0) return true;
  const pm = detectPackageManager(cwd, packageManager);
  const deduped = [...new Set(packages)];

  // npm: npm install pkg1 pkg2 | yarn: yarn add pkg1 pkg2 | pnpm: pnpm add pkg1 pkg2
  let cmd: string;
  let args: string[];
  if (pm === "npm") {
    cmd = "npm";
    args = ["install", "--no-audit", "--no-fund", ...deduped];
  } else if (pm === "yarn") {
    cmd = "yarn";
    args = ["add", "--non-interactive", ...deduped];
  } else {
    cmd = "pnpm";
    args = ["add", ...deduped];
  }

  const spinner = ora({
    text: `Installing ${deduped.length} package(s) with ${pc.cyan(pm)}...`,
    color: "magenta",
    spinner: "dots",
  }).start();

  try {
    await execa(cmd, args, { cwd, stdio: "pipe" });
    spinner.succeed(pc.green(`Packages installed with ${pc.bold(pm)}`));
    return true;
  } catch (err: any) {
    spinner.fail(pc.red(`Failed to install packages with ${pc.bold(pm)}`));
    printError(err?.message || String(err));
    return false;
  }
}

type CopyResult = "copied" | "skipped" | "missing";

const JS_EXTENSIONS: Record<string, string> = { ".ts": ".js", ".tsx": ".jsx" };

/**
 * Feature files are registered with TypeScript paths; the JS template ships the
 * same files as .js/.jsx, so try that variant before giving up on a template.
 */
function relativeVariants(relativePath: string): string[] {
  const ext = path.extname(relativePath);
  const jsExt = JS_EXTENSIONS[ext];
  if (!jsExt) return [relativePath];
  return [relativePath, relativePath.slice(0, -ext.length) + jsExt];
}

/** First variant of `relativePath` that exists under `templateDir/src`. */
async function findInTemplate(
  templateDir: string,
  relativePath: string
): Promise<string | null> {
  for (const rel of relativeVariants(relativePath)) {
    if (await fs.pathExists(path.join(templateDir, "src", rel))) return rel;
  }
  return null;
}

/**
 * Copy a single file from the project's template to the target, falling back to
 * the default template when the file isn't part of that template (e.g. Soroban
 * hooks, which the defi template doesn't ship).
 */
async function copyFile(
  template: ResolvedTemplate,
  targetDir: string,
  relativePath: string,
  force: boolean
): Promise<{ result: CopyResult; path: string; fromDefault: boolean }> {
  let fromDefault = false;
  let rel = await findInTemplate(template.dir, relativePath);

  if (!rel && template.dir !== template.defaultDir) {
    rel = await findInTemplate(template.defaultDir, relativePath);
    fromDefault = rel !== null;
  }

  if (!rel) {
    return { result: "missing", path: relativePath, fromDefault: false };
  }

  const src = path.join(
    fromDefault ? template.defaultDir : template.dir,
    "src",
    rel
  );
  const dest = path.join(targetDir, "src", rel);

  if ((await fs.pathExists(dest)) && !force) {
    return { result: "skipped", path: rel, fromDefault };
  }

  await fs.ensureDir(path.dirname(dest));
  await fs.copy(src, dest, { overwrite: true });
  return { result: "copied", path: rel, fromDefault };
}

interface FeatureCopyReport {
  copied: string[];
  skipped: string[];
  /** Copied from the default template because the project's template lacks them */
  fallback: string[];
  /** Not present in either template (e.g. a component that hasn't landed yet) */
  missing: string[];
}

/**
 * Add a single feature: copy its files and record npm deps. Does not install deps.
 */
async function addFeatureFiles(
  template: ResolvedTemplate,
  targetDir: string,
  feature: FeatureDef,
  force: boolean
): Promise<FeatureCopyReport> {
  const report: FeatureCopyReport = {
    copied: [],
    skipped: [],
    fallback: [],
    missing: [],
  };

  for (const rel of feature.files) {
    const { result, path: p, fromDefault } = await copyFile(
      template,
      targetDir,
      rel,
      force
    );
    if (result === "copied") report.copied.push(p);
    else if (result === "skipped") report.skipped.push(p);
    else report.missing.push(p);
    if (fromDefault && result !== "missing") report.fallback.push(p);
  }

  return report;
}

/**
 * Run nextellar add for a feature: resolve deps, copy files, install npm deps.
 */
export async function runAdd(
  featureId: string,
  options: AddOptions = {}
): Promise<{ success: boolean; message?: string }> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const force = !!options.force;
  const skipInstall = !!options.skipInstall;
  const packageManager = options.packageManager;

  const rawId = featureId.trim().toLowerCase();
  const feature = getFeature(rawId);
  if (!feature) {
    return {
      success: false,
      message: `Unknown feature "${featureId}". Run ${pc.cyan("npx nextellar add --list")} to see available features.`,
    };
  }

  // Ensure we're in a Next.js-like project (has src or package.json with next)
  const pkgPath = path.join(cwd, "package.json");
  if (!(await fs.pathExists(pkgPath))) {
    return {
      success: false,
      message: "No package.json found in the current directory. Run this from your Next.js project root.",
    };
  }

  const template = await resolveProjectTemplate(cwd);
  // resolveFeatureWithDeps returns dependencies first, so hooks are always
  // written before the components that import them.
  const featuresToAdd = resolveFeatureWithDeps(rawId);
  const allCopied: string[] = [];
  const allSkipped: string[] = [];
  const allFallback: string[] = [];
  const allMissing: string[] = [];
  const allNpmDeps = new Set<string>();

  for (const f of featuresToAdd) {
    const { copied, skipped, fallback, missing } = await addFeatureFiles(
      template,
      cwd,
      f,
      force
    );
    allCopied.push(...copied);
    allSkipped.push(...skipped);
    allFallback.push(...fallback);
    allMissing.push(...missing);
    f.npmDependencies.forEach((d) => allNpmDeps.add(d));
  }

  if (allCopied.length === 0 && allSkipped.length === 0 && allMissing.length > 0) {
    return {
      success: false,
      message: `No files for "${rawId}" are available in the ${pc.bold(template.name)} or ${pc.bold(DEFAULT_TEMPLATE)} template:\n  ${allMissing.join("\n  ")}`,
    };
  }

  if (allCopied.length === 0 && allSkipped.length > 0) {
    return {
      success: false,
      message: `All files already exist. Use ${pc.cyan("--force")} to overwrite.`,
    };
  }

  if (!skipInstall && allNpmDeps.size > 0) {
    const pkgJson = await fs.readJson(pkgPath);
    const existingDeps = {
      ...(pkgJson.dependencies || {}),
      ...(pkgJson.devDependencies || {}),
    };
    const toInstall = [...allNpmDeps].filter((pkg) => !existingDeps[pkg]);
    if (toInstall.length > 0) {
      const ok = await installPackages(cwd, toInstall, packageManager);
      if (!ok) {
        return {
          success: false,
          message: "Files were copied but package installation failed. Run your package manager install manually.",
        };
      }
    }
  }

  const lines: string[] = [];
  lines.push(pc.green("✔") + " " + pc.bold(`Feature "${rawId}" added.`));
  lines.push(pc.dim(`Source template: ${template.name}`));
  if (allCopied.length > 0) {
    lines.push("");
    lines.push(pc.dim("Added files:"));
    allCopied.forEach((p) => lines.push("  " + p));
  }
  if (allSkipped.length > 0 && !force) {
    lines.push("");
    lines.push(pc.dim("Skipped (already exist):"));
    allSkipped.forEach((p) => lines.push("  " + p));
  }
  if (allFallback.length > 0) {
    lines.push("");
    lines.push(
      pc.yellow(
        `Not in the ${pc.bold(template.name)} template — copied from ${pc.bold(DEFAULT_TEMPLATE)}:`
      )
    );
    allFallback.forEach((p) => lines.push("  " + p));
  }
  if (allMissing.length > 0) {
    lines.push("");
    lines.push(
      pc.yellow(
        `Not available in any template yet (skipped):`
      )
    );
    allMissing.forEach((p) => lines.push("  " + p));
  }
  lines.push("");
  lines.push(pc.dim("Next steps:"));
  lines.push("  • Wrap your app with WalletProvider (if you added wallet) in layout.tsx");
  lines.push("  • Import hooks and components from src/hooks and src/components");
  console.log(lines.join("\n"));

  return { success: true };
}
