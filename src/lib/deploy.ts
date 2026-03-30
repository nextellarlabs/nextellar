import path from "path";
import fs from "fs-extra";
import { spawn } from "child_process";
import pc from "picocolors";

export interface DeployOptions {
  cwd?: string;
  dryRun?: boolean;
  token?: string;
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
    `  Contracts: ${pc.cyan(context.hasContracts ? "detected (/contracts)" : "not detected")}`
  );

  if (dryRun) {
    console.log(`\n${pc.yellow("Dry run mode: no bundle created")}`);
    console.log(`  Would create: ${pc.cyan(bundlePath)}`);
    console.log("  Excludes: node_modules, .git, .next/cache");
    printComingSoonMessage();
    return;
  }

  await fs.ensureDir(path.dirname(bundlePath));
  await createBundle(context.projectRoot, bundlePath);
  const bundleStats = await fs.stat(bundlePath);

  await writeBundleState(projectRoot, bundlePath, bundleStats.size, context.hasContracts);

  console.log(`\n${pc.green("✔ Deployment bundle created")}`);
  console.log(`  Path: ${pc.cyan(bundlePath)}`);
  console.log(`  Size: ${pc.cyan(formatBytes(bundleStats.size))}`);
  console.log(`  Saved: ${pc.cyan(path.join(projectRoot, DEPLOY_STATE_DIR, DEPLOY_STATE_FILE))}`);

  // TODO(platform): accept --token <api-token> and authenticate upload requests.
  // TODO(platform): POST bundle to /v1/deployments and stream deployment logs.
  // TODO(platform): print deployment URL when build completes on Nextellar Cloud.
  if (options.token) {
    console.log(
      `\n${pc.dim(
        "API token received. Nextellar Cloud API upload is not available yet."
      )}`
    );
  }

  printComingSoonMessage();
}

async function validateProject(projectRoot: string): Promise<DeployContext> {
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (!(await fs.pathExists(packageJsonPath))) {
    throw new Error(
      "No package.json found in this directory. Run this command from a Next.js project root."
    );
  }

  const packageJson = (await fs.readJson(packageJsonPath)) as Record<string, any>;
  const dependencies = packageJson.dependencies || {};
  const devDependencies = packageJson.devDependencies || {};
  const hasNextDependency = Boolean(dependencies.next || devDependencies.next);

  if (!hasNextDependency) {
    throw new Error(
      "This is not a Next.js project (missing \"next\" dependency in package.json)."
    );
  }

  const nextDir = path.join(projectRoot, ".next");
  if (!(await fs.pathExists(nextDir))) {
    throw new Error("Missing production build (.next). Run 'npm run build' first.");
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

async function createBundle(projectRoot: string, bundlePath: string): Promise<void> {
  const args = [
    "-czf",
    bundlePath,
    "--exclude=node_modules",
    "--exclude=.git",
    "--exclude=.next/cache",
    "--exclude=.nextellar/deploy",
    "-C",
    projectRoot,
    ".",
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", args, {
      stdio: "inherit",
    });

    child.on("error", (error) => {
      reject(
        new Error(
          `Failed to run tar while creating deployment bundle: ${error.message}`
        )
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Failed to create deployment bundle (tar exit code ${code}).`));
    });
  });
}

async function writeBundleState(
  projectRoot: string,
  bundlePath: string,
  bundleSizeBytes: number,
  hasContracts: boolean
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
    { spaces: 2 }
  );
}

function printComingSoonMessage() {
  console.log(
    `\n${pc.yellow(
      "Nextellar Cloud is coming soon. For now, deploy with Vercel: npx vercel"
    )}`
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
