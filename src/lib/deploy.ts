import path from "path";
import fs from "fs-extra";
import { create } from "tar";
import pc from "picocolors";

/** Progress update reported while the deployment bundle is being written. */
export interface BundleProgress {
  /** Number of files packed into the bundle so far. */
  filesPacked: number;
  /** Total number of files that will be packed, known up front from the pre-scan. */
  totalFiles: number;
  /** Cumulative uncompressed bytes packed so far. */
  bytesPacked: number;
  /** Total uncompressed bytes that will be packed, known up front from the pre-scan. */
  totalBytes: number;
  /** Path of the entry that was just packed (relative to the project root). */
  lastEntry: string;
}

export interface DeployOptions {
  cwd?: string;
  dryRun?: boolean;
  token?: string;
  sizeThreshold?: number;
  /**
   * Called after each file is written into the bundle archive (e.g. a
   * `contracts/` directory's compiled `.wasm` output, or any other project
   * file). Large bundles otherwise give no feedback until the whole archive
   * is done — this lets callers (CLI progress bar, tests) observe progress
   * as it happens.
   */
  onProgress?: (progress: BundleProgress) => void;
}

interface DeployContext {
  projectRoot: string;
  packageJsonPath: string;
  packageJson: Record<string, any>;
  nextDir: string;
  contractsDir: string;
  hasContracts: boolean;
}

const DEPLOY_STATE_DIR = path.join(".nextellar", "deploy");
const DEPLOY_STATE_FILE = "latest-bundle.json";

export async function runDeploy(options: DeployOptions = {}): Promise<void> {
  const projectRoot = options.cwd || process.cwd();
  const dryRun = !!options.dryRun;

  const context = await validateProject(projectRoot);
  const bundlePath = getBundlePath(projectRoot);

  console.log(pc.green("✔ Project validation passed"));
  console.log(`  Root: ${pc.cyan(context.projectRoot)}`);
  console.log(
    `  Contracts: ${pc.cyan(context.hasContracts ? "detected (/contracts)" : "not detected")}`,
  );

  if (dryRun) {
    console.log(`\n${pc.yellow("Dry run mode: no bundle created")}`);
    console.log(`  Would create: ${pc.cyan(bundlePath)}`);
    console.log("  Excludes: node_modules, .git, .next/cache");
    printComingSoonMessage();
    return;
  }

  await fs.ensureDir(path.dirname(bundlePath));
  await createBundle(context.projectRoot, bundlePath, options.onProgress);
  const bundleStats = await fs.stat(bundlePath);

  await writeBundleState(
    projectRoot,
    bundlePath,
    bundleStats.size,
    context.hasContracts,
  );

  console.log(`\n${pc.green("✔ Deployment bundle created")}`);
  console.log(`  Path: ${pc.cyan(bundlePath)}`);
  console.log(`  Size: ${pc.cyan(formatBytes(bundleStats.size))}`);
  console.log(
    `  Saved: ${pc.cyan(path.join(projectRoot, DEPLOY_STATE_DIR, DEPLOY_STATE_FILE))}`,
  );

  // Bundle size report and threshold warning
  const sizeThreshold = options.sizeThreshold || 50 * 1024 * 1024; // Default 50MB

  console.log(`\n${pc.cyan("Bundle Size Report:")}`);
  console.log(`  Total: ${pc.bold(formatBytes(bundleStats.size))}`);
  console.log(`  Threshold: ${pc.dim(formatBytes(sizeThreshold))}`);

  if (bundleStats.size > sizeThreshold) {
    console.log(
      `\n${pc.yellow("⚠ Warning:")} Bundle size (${formatBytes(bundleStats.size)}) exceeds threshold (${formatBytes(sizeThreshold)})`,
    );
    console.log(
      `  Consider optimizing your build or increasing the threshold with --size-threshold`,
    );
  } else {
    console.log(`\n${pc.green("✔")} Bundle size is within acceptable limits`);
  }

  // TODO(platform): accept --token <api-token> and authenticate upload requests.
  // TODO(platform): POST bundle to /v1/deployments and stream deployment logs.
  // TODO(platform): print deployment URL when build completes on Nextellar Cloud.
  if (options.token) {
    console.log(
      `\n${pc.dim(
        "API token received. Nextellar Cloud API upload is not available yet.",
      )}`,
    );
  }

  printComingSoonMessage();
}

async function validateProject(projectRoot: string): Promise<DeployContext> {
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (!(await fs.pathExists(packageJsonPath))) {
    throw new Error(
      "No package.json found in this directory. Run this command from a Next.js project root.",
    );
  }

  const packageJson = (await fs.readJson(packageJsonPath)) as Record<
    string,
    any
  >;
  const dependencies = packageJson.dependencies || {};
  const devDependencies = packageJson.devDependencies || {};
  const hasNextDependency = Boolean(dependencies.next || devDependencies.next);

  if (!hasNextDependency) {
    throw new Error(
      'This is not a Next.js project (missing "next" dependency in package.json).',
    );
  }

  const nextDir = path.join(projectRoot, ".next");
  if (!(await fs.pathExists(nextDir))) {
    throw new Error(
      "Missing production build (.next). Run 'npm run build' first.",
    );
  }

  const contractsDir = path.join(projectRoot, "contracts");
  const hasContracts = await fs.pathExists(contractsDir);

  return {
    projectRoot,
    packageJsonPath,
    packageJson,
    nextDir,
    contractsDir,
    hasContracts,
  };
}

function getBundlePath(projectRoot: string): string {
  const appName = path.basename(projectRoot);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(projectRoot, DEPLOY_STATE_DIR, `${appName}-${stamp}.tar.gz`);
}

const BUNDLE_EXCLUDES = [
  "node_modules",
  ".git",
  ".next/cache",
  ".nextellar/deploy",
];

/** True if `normalizedPath` (bare, forward-slash, no leading "./") falls under one of the bundle's excluded directories. */
function isExcludedFromBundle(normalizedPath: string): boolean {
  for (const pattern of BUNDLE_EXCLUDES) {
    if (
      normalizedPath === pattern ||
      normalizedPath.startsWith(`${pattern}/`)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively walks `dir` (relative to `projectRoot`) and returns the total
 * byte size and count of every regular file that will be packed — i.e. every
 * file not excluded by `BUNDLE_EXCLUDES`. Used to give `onProgress` a known
 * denominator (`totalBytes`/`totalFiles`) before packing starts.
 */
async function scanBundleContents(
  projectRoot: string,
  dir = ".",
): Promise<{ totalBytes: number; totalFiles: number }> {
  let totalBytes = 0;
  let totalFiles = 0;

  const absDir = path.join(projectRoot, dir);
  const entries = await fs.readdir(absDir, { withFileTypes: true });

  for (const entry of entries) {
    const relPath = path
      .join(dir, entry.name)
      .replace(/\\/g, "/")
      .replace(/^\.\//, "");
    if (isExcludedFromBundle(relPath)) continue;

    const absPath = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      const sub = await scanBundleContents(projectRoot, relPath);
      totalBytes += sub.totalBytes;
      totalFiles += sub.totalFiles;
    } else if (entry.isFile()) {
      const stats = await fs.stat(absPath);
      totalBytes += stats.size;
      totalFiles += 1;
    }
    // Symlinks and other special file types are skipped for the size/count
    // estimate; tar still packs them, but they don't move the byte total.
  }

  return { totalBytes, totalFiles };
}

async function createBundle(
  projectRoot: string,
  bundlePath: string,
  onProgress?: (progress: BundleProgress) => void,
): Promise<void> {
  const { totalBytes, totalFiles } = onProgress
    ? await scanBundleContents(projectRoot)
    : { totalBytes: 0, totalFiles: 0 };

  let bytesPacked = 0;
  let filesPacked = 0;

  await create(
    {
      gzip: true,
      file: bundlePath,
      cwd: projectRoot,
      filter: (filePath: string) => {
        // node-tar passes paths prefixed with "./" (the packed entry name);
        // strip it so the exclusion patterns match.
        const normalizedPath = filePath
          .replace(/\\/g, "/")
          .replace(/^\.\//, "");
        return !isExcludedFromBundle(normalizedPath);
      },
      onWriteEntry: onProgress
        ? (entry) => {
            // Directory entries have no byte size of their own; only report
            // progress for the files that actually contribute bytes.
            if (entry.type !== "File" && entry.type !== "ContiguousFile")
              return;

            entry.on("end", () => {
              const normalizedPath = entry.path
                .replace(/\\/g, "/")
                .replace(/^\.\//, "");
              bytesPacked += entry.stat?.size ?? 0;
              filesPacked += 1;
              onProgress({
                filesPacked,
                totalFiles,
                bytesPacked,
                totalBytes,
                lastEntry: normalizedPath,
              });
            });
          }
        : undefined,
    },
    ["."],
  );
}

async function writeBundleState(
  projectRoot: string,
  bundlePath: string,
  bundleSizeBytes: number,
  hasContracts: boolean,
): Promise<void> {
  const stateDir = path.join(projectRoot, DEPLOY_STATE_DIR);
  const statePath = path.join(stateDir, DEPLOY_STATE_FILE);
  await fs.ensureDir(stateDir);

  await fs.writeJson(
    statePath,
    {
      bundlePath,
      bundleSizeBytes,
      hasContracts,
      createdAt: new Date().toISOString(),
    },
    { spaces: 2 },
  );
}

function printComingSoonMessage() {
  console.log(
    `\n${pc.yellow(
      "Nextellar Cloud is coming soon. For now, deploy with Vercel: npx vercel",
    )}`,
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
