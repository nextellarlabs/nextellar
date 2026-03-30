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

/**
 * Resolve the default template directory (TypeScript template).
 */
function getTemplateDir(): string {
  const base = path.resolve(__dirname, "..");
  const fromSrc = path.resolve(base, "templates/default");
  const fromDist = path.resolve(__dirname, "../../../src/templates/default");
  if (fs.existsSync(fromSrc)) return fromSrc;
  if (fs.existsSync(fromDist)) return fromDist;
  throw new Error("Nextellar default template not found.");
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
    console.error(err?.message || err);
    return false;
  }
}

type CopyResult = "copied" | "skipped" | "missing";

/**
 * Copy a single file from template to target. Skips if destination exists and !force.
 */
async function copyFile(
  templateDir: string,
  targetDir: string,
  relativePath: string,
  force: boolean
): Promise<{ result: CopyResult; path: string }> {
  const src = path.join(templateDir, "src", relativePath);
  const dest = path.join(targetDir, "src", relativePath);

  if (!(await fs.pathExists(src))) {
    return { result: "missing", path: relativePath };
  }

  if (await fs.pathExists(dest) && !force) {
    return { result: "skipped", path: relativePath };
  }

  await fs.ensureDir(path.dirname(dest));
  await fs.copy(src, dest, { overwrite: true });
  return { result: "copied", path: relativePath };
}

/**
 * Add a single feature: copy its files and record npm deps. Does not install deps.
 */
async function addFeatureFiles(
  templateDir: string,
  targetDir: string,
  feature: FeatureDef,
  force: boolean
): Promise<{ copied: string[]; skipped: string[] }> {
  const copied: string[] = [];
  const skipped: string[] = [];

  for (const rel of feature.files) {
    const { result, path: p } = await copyFile(
      templateDir,
      targetDir,
      rel,
      force
    );
    if (result === "copied") copied.push(p);
    else if (result === "skipped") skipped.push(p);
  }

  return { copied, skipped };
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

  const templateDir = getTemplateDir();
  const featuresToAdd = resolveFeatureWithDeps(rawId);
  const allCopied: string[] = [];
  const allSkipped: string[] = [];
  const allNpmDeps = new Set<string>();

  for (const f of featuresToAdd) {
    const { copied, skipped } = await addFeatureFiles(
      templateDir,
      cwd,
      f,
      force
    );
    allCopied.push(...copied);
    allSkipped.push(...skipped);
    f.npmDependencies.forEach((d) => allNpmDeps.add(d));
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
  lines.push("");
  lines.push(pc.dim("Next steps:"));
  lines.push("  • Wrap your app with WalletProvider (if you added wallet) in layout.tsx");
  lines.push("  • Import hooks and components from src/hooks and src/components");
  console.log(lines.join("\n"));

  return { success: true };
}
