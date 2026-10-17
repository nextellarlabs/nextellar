import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { execa } from "execa";
import {
  detectPackageManager,
  runInstall,
  type PackageManager,
} from "./install.js";
import { trackScaffoldEvent } from "./telemetry.js";
import { fileURLToPath } from "url";
import { confirm } from "@clack/prompts";
import { validateHorizonUrl, validateSorobanUrl } from "./validate.js";
import { runPreflight } from "./preflight.js";
import { resolveTemplateDir } from "./templates.js";
import { printError, printWarning } from "./feedback.js";
import {
  assertPackageManagerMatches,
  detectWorkspace,
  ensureWorkspaceIncludes,
  findWorkspaceRoot,
  isCoveredByWorkspace,
  removeNestedLockfiles,
  resolveWorkspaceTarget,
  type WorkspaceInfo,
} from "./workspace.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ScaffoldOptions {
  appName: string;
  useTs: boolean;
  template?: string;
  withContracts?: boolean;
  horizonUrl?: string;
  sorobanUrl?: string;
  wallets?: string[];
  defaults?: boolean;
  skipInstall?: boolean;
  packageManager?: PackageManager;
  installTimeout?: number;
  telemetryEnabled?: boolean;
  cliVersion?: string;
  force?: boolean;
  dryRun?: boolean;
  git?: boolean;
  /**
   * Scaffold into an existing npm/yarn/pnpm/bun workspace (#1117). `true`
   * finds the nearest workspace root above the current directory; a string
   * is an explicit workspace root path. `appName` is then a bare name
   * (placed under `apps/` or `packages/`) or a path relative to the root.
   */
  workspace?: boolean | string;
}

export interface ScaffoldResult {
  /** Absolute directory the project was (or, for a dry run, would be) written to. */
  targetDir: string;
  /** Package manager used for (or recommended for) installing. */
  packageManager: PackageManager;
  /** Present in workspace mode. */
  workspace?: {
    root: string;
    relativeDir: string;
    packageManager: PackageManager;
    turbo: boolean;
    /** True when the workspace config had to be extended to include the app. */
    registered: boolean;
  };
}

export async function scaffold(
  options: ScaffoldOptions,
): Promise<ScaffoldResult> {
  const {
    appName,
    useTs,
    template,
    withContracts,
    horizonUrl,
    sorobanUrl,
    wallets,
    skipInstall,
    packageManager,
    installTimeout,
    telemetryEnabled,
    cliVersion,
    force,
    defaults,
    dryRun,
    git,
    workspace,
  } = options;

  // Preflight toolchain check (#908): fail fast with guidance when the local
  // Node.js toolchain is too old, instead of crashing mid-install. npm is only
  // required when we will actually install, so skip that check for
  // --skip-install / offline scaffolding.
  const preflight = await runPreflight(undefined, 20, !!skipInstall);
  if (!preflight.ok) {
    for (const failure of preflight.failures) {
      printError(failure);
    }
    throw new Error(
      "Toolchain check failed. Fix the issues above and re-run scaffold.",
    );
  }

  const telemetryTemplate = template || "default";
  const telemetryLanguage = useTs ? "typescript" : "javascript";
  const telemetryNetwork =
    horizonUrl && horizonUrl.includes("public") ? "public" : "testnet";
  const telemetryWallets =
    wallets && wallets.length > 0 ? wallets : ["freighter", "albedo", "lobstr"];

  const templateName = template || "default";

  // Resolves the starter directory for this template + language pair, and
  // throws with the list of valid options when the name is unknown or has
  // no variant for the requested language. See src/lib/templates.ts.
  const resolvedTemplateName = resolveTemplateDir(templateName, useTs);

  // Validate custom URL overrides if provided
  if (horizonUrl) {
    validateHorizonUrl(horizonUrl);
  }
  if (sorobanUrl) {
    validateSorobanUrl(sorobanUrl);
  }

  // Resolve templates across src/dist and nested workspace layouts.
  const templateRoots = [
    path.resolve(__dirname, "../templates"),
    path.resolve(__dirname, "../../templates"),
    path.resolve(__dirname, "../../../src/templates"),
    path.resolve(__dirname, "../../nextellar/src/templates"),
    path.resolve(__dirname, "../../../nextellar/src/templates"),
  ];
  const templateRoot =
    templateRoots.find((candidate) =>
      fs.existsSync(path.join(candidate, resolvedTemplateName, "package.json")),
    ) || templateRoots[templateRoots.length - 1];
  const templateDir = path.join(templateRoot, resolvedTemplateName);

  // Workspace mode (#1117): resolve the workspace root first, so an invalid
  // or missing workspace fails before anything is written.
  let workspaceInfo: WorkspaceInfo | null = null;
  if (workspace) {
    workspaceInfo =
      typeof workspace === "string"
        ? detectWorkspace(path.resolve(process.cwd(), workspace))
        : findWorkspaceRoot(process.cwd());
    if (!workspaceInfo) {
      const where =
        typeof workspace === "string"
          ? path.resolve(process.cwd(), workspace)
          : `${process.cwd()} or any parent directory`;
      throw new Error(
        `No workspace found at ${where}. Expected a package.json with a "workspaces" field or a pnpm-workspace.yaml.`,
      );
    }
    assertPackageManagerMatches(workspaceInfo, packageManager);
  }
  const workspaceTarget = workspaceInfo
    ? resolveWorkspaceTarget(workspaceInfo, appName)
    : null;

  const targetDir =
    workspaceTarget?.targetDir ?? path.resolve(process.cwd(), appName);
  // In a workspace the package name is the folder name, never a path.
  const packageName = workspaceTarget?.packageName ?? appName;
  const finalPackageManager = workspaceInfo
    ? workspaceInfo.packageManager
    : detectPackageManager(targetDir, packageManager);
  // Installs run once from the workspace root so the new app is linked.
  const installCwd = workspaceInfo ? workspaceInfo.root : targetDir;
  const workspaceRegistered =
    !!workspaceInfo &&
    !!workspaceTarget &&
    !isCoveredByWorkspace(workspaceInfo.patterns, workspaceTarget.relativeDir);
  const buildResult = (registered: boolean): ScaffoldResult => ({
    targetDir,
    packageManager: finalPackageManager,
    ...(workspaceInfo && workspaceTarget
      ? {
          workspace: {
            root: workspaceInfo.root,
            relativeDir: workspaceTarget.relativeDir,
            packageManager: workspaceInfo.packageManager,
            turbo: workspaceInfo.turbo,
            registered,
          },
        }
      : {}),
  });

  // Dry-run mode: print plan without writing
  if (dryRun) {
    console.log(pc.bold("\n📋 Scaffold Plan (dry run)\n"));
    console.log(`  ${pc.cyan("Project:")}    ${appName}`);
    console.log(`  ${pc.cyan("Template:")}   ${resolvedTemplateName}`);
    console.log(
      `  ${pc.cyan("Language:")}   ${useTs ? "TypeScript" : "JavaScript"}`,
    );
    console.log(`  ${pc.cyan("Target:")}     ${targetDir}`);
    console.log(`  ${pc.cyan("Contracts:")}  ${withContracts ? "Yes" : "No"}`);
    console.log(
      `  ${pc.cyan("Network:")}    ${horizonUrl && horizonUrl.includes("public") ? "PUBLIC" : "TESTNET"}`,
    );
    console.log(
      `  ${pc.cyan("Wallets:")}    ${(wallets && wallets.length > 0 ? wallets : ["freighter", "albedo", "lobstr"]).join(", ")}`,
    );
    console.log(`  ${pc.cyan("Pkg manager:")} ${finalPackageManager}`);
    if (workspaceInfo && workspaceTarget) {
      console.log(`  ${pc.cyan("Workspace:")}  ${workspaceInfo.root}`);
      console.log(
        `  ${pc.cyan("Workspace path:")} ${workspaceTarget.relativeDir}${workspaceInfo.turbo ? " (Turborepo)" : ""}`,
      );
      if (workspaceRegistered) {
        console.log(
          `  ${pc.cyan("Workspace config:")} would add "${workspaceTarget.relativeDir}" to ${workspaceInfo.configSource}`,
        );
      }
    }
    console.log("");

    // List files that would be copied
    console.log(pc.bold("  Files to create:"));
    const walkDir = async (dir: string, prefix: string): Promise<string[]> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const fullPath = path.join(dir, entry.name);
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          files.push(...(await walkDir(fullPath, relPath)));
        } else {
          files.push(relPath);
        }
      }
      return files;
    };

    const templateFiles = await walkDir(templateDir, "");
    for (const f of templateFiles) {
      console.log(`    ${pc.green("+")} ${f}`);
    }

    if (withContracts) {
      const contractsDir = path.join(templateRoot, "contracts-template");
      if (await fs.pathExists(contractsDir)) {
        console.log(`    ${pc.yellow("+")} ${pc.dim("(contracts overlay)")}`);
        const contractFiles = await walkDir(contractsDir, "");
        for (const f of contractFiles) {
          console.log(`    ${pc.yellow("+")} ${f}`);
        }
      }
    }

    // Show placeholder substitutions
    console.log("");
    console.log(pc.bold("  Placeholder substitutions:"));
    console.log(`    {{APP_NAME}}         → ${packageName}`);
    console.log(
      `    {{HORIZON_URL}}      → ${horizonUrl || "https://horizon-testnet.stellar.org"}`,
    );
    console.log(
      `    {{SOROBAN_URL}}      → ${sorobanUrl || "https://soroban-testnet.stellar.org"}`,
    );
    console.log(
      `    {{NETWORK}}          → ${horizonUrl && horizonUrl.includes("public") ? "PUBLIC" : "TESTNET"}`,
    );
    console.log(
      `    {{WALLETS}}          → ${JSON.stringify(wallets && wallets.length > 0 ? wallets : ["freighter", "albedo", "lobstr"])}`,
    );
    console.log(`    {{NEXTELLAR_VERSION}} → ${cliVersion || "0.0.0"}`);
    console.log(`    {{TEMPLATE_NAME}}    → ${templateName}`);
    console.log(`    {{TIMESTAMP}}        → ${new Date().toISOString()}`);

    console.log("");
    console.log(
      pc.dim("  No files were written. Remove --dry-run to execute."),
    );
    console.log("");
    return buildResult(workspaceRegistered);
  }

  if (await fs.pathExists(targetDir)) {
    if (!force) {
      throw new Error(`Directory "${appName}" already exists.`);
    }

    // Handle force flag
    const shouldPrompt =
      process.stdout.isTTY &&
      process.stdin.isTTY &&
      !defaults &&
      !process.env.CI;

    if (shouldPrompt) {
      const overwrite = await confirm({
        message: `Directory "${appName}" already exists. Overwrite?`,
      });

      if (overwrite !== true) {
        process.exit(0);
      }
    }

    // Remove existing directory
    await fs.remove(targetDir);
  }

  // Tracks whether fs.copy completed, so the catch block below only wipes
  // targetDir for failures before/during that copy (#673) — once files are
  // scaffolded, a later install failure must never delete them, or "run
  // install manually" (the error message we give the user) becomes
  // impossible: there'd be nothing left to install into.
  let filesScaffolded = false;

  try {
    await fs.copy(templateDir, targetDir, {
      filter: (src) => {
        const basename = path.basename(src);
        return basename !== ".git" && basename !== "node_modules";
      },
      preserveTimestamps: true,
    });
    filesScaffolded = true;

    // A workspace package must not carry its own lockfile: the root
    // lockfile is the single source of truth for the whole workspace.
    if (workspaceInfo) {
      await removeNestedLockfiles(targetDir);
    }

    if (withContracts) {
      const contractsTemplateDir = path.join(
        templateRoot,
        "contracts-template",
      );

      if (await fs.pathExists(contractsTemplateDir)) {
        await fs.copy(contractsTemplateDir, targetDir, {
          preserveTimestamps: true,
        });
      }

      const pkgJsonPath = path.join(targetDir, "package.json");
      if (await fs.pathExists(pkgJsonPath)) {
        const pkgJson = await fs.readJson(pkgJsonPath);
        pkgJson.scripts = pkgJson.scripts || {};
        pkgJson.scripts["contracts:build"] =
          "cd contracts && stellar contract build";
        pkgJson.scripts["contracts:test"] = "cd contracts && cargo test";
        await fs.writeJson(pkgJsonPath, pkgJson, { spaces: 2 });
      }

      const envExamplePath = path.join(targetDir, ".env.example");
      await fs.appendFile(
        envExamplePath,
        `\n# Soroban Smart Contracts\nNEXT_PUBLIC_HELLO_WORLD_CONTRACT_ID=C_REPLACE_WITH_YOUR_CONTRACT_ID\n`,
      );
    }

    const escapeRegex = (value: string): string =>
      value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const replaceInFile = async (
      filePath: string,
      replacements: Record<string, string>,
    ) => {
      const content = await fs.readFile(filePath, "utf8");
      const keys = Object.keys(replacements);
      if (keys.length === 0) {
        return;
      }
      // Single-pass regex replacement: build one alternation of all keys and
      // resolve each match against the replacements map. This avoids the
      // previous N full string scans (one per placeholder) and stays correct
      // when placeholders contain regex metacharacters like `{` or `}`.
      const pattern = new RegExp(keys.map(escapeRegex).join("|"), "g");
      const newContent = content.replace(
        pattern,
        (match) => replacements[match] ?? match,
      );
      await fs.writeFile(filePath, newContent, "utf8");
    };

    const config = {
      "{{APP_NAME}}": packageName,
      "{{HORIZON_URL}}": horizonUrl || "https://horizon-testnet.stellar.org",
      "{{SOROBAN_URL}}": sorobanUrl || "https://soroban-testnet.stellar.org",
      "{{NETWORK}}":
        horizonUrl && horizonUrl.includes("public") ? "PUBLIC" : "TESTNET",
      "{{WALLETS}}":
        wallets && wallets.length > 0
          ? JSON.stringify(wallets)
          : JSON.stringify(["freighter", "albedo", "lobstr"]),
      "{{NEXTELLAR_VERSION}}":
        cliVersion ||
        (() => {
          try {
            const pkgPath = fs.existsSync(
              path.resolve(__dirname, "../../package.json"),
            )
              ? path.resolve(__dirname, "../../package.json")
              : path.resolve(__dirname, "../../../package.json");
            const myPkg = fs.readJsonSync(pkgPath);
            return myPkg.version || "0.0.0";
          } catch {
            return "0.0.0";
          }
        })(),
      "{{TEMPLATE_NAME}}": templateName,
      "{{TIMESTAMP}}": new Date().toISOString(),
    };

    const filesToProcess = [
      path.join(targetDir, "package.json"),
      path.join(targetDir, "package-lock.json"),
      path.join(targetDir, "README.md"),
      path.join(targetDir, "src/contexts/WalletProvider.tsx"),
      path.join(targetDir, "src/contexts/WalletProvider.jsx"),
      path.join(targetDir, "src/lib/stellar-wallet-kit.ts"),
      path.join(targetDir, "src/lib/stellar-wallet-kit.js"),
      path.join(targetDir, "src/hooks/useSorobanContract.ts"),
      path.join(targetDir, "src/hooks/useSorobanContract.js"),
      path.join(targetDir, "src/hooks/useSorobanEvents.ts"),
      path.join(targetDir, "src/hooks/useSorobanEvents.js"),
      path.join(targetDir, ".env.example"),
      path.join(targetDir, ".nextellar/config.json"),
    ];

    for (const filePath of filesToProcess) {
      if (await fs.pathExists(filePath)) {
        await replaceInFile(filePath, config);
      }
    }

    console.log(`✔️  Scaffolded "${appName}" from template.`);

    let registered = false;
    if (workspaceInfo && workspaceTarget) {
      registered = await ensureWorkspaceIncludes(
        workspaceInfo,
        workspaceTarget.relativeDir,
      );
      if (registered) {
        console.log(
          `✔️  Added "${workspaceTarget.relativeDir}" to ${workspaceInfo.configSource} workspaces.`,
        );
      }
    }

    const result = await runInstall({
      cwd: installCwd,
      skipInstall,
      packageManager: workspaceInfo
        ? workspaceInfo.packageManager
        : packageManager,
      timeout: installTimeout,
    });

    if (!result.success && !skipInstall) {
      // Files are already on disk at this point (filesScaffolded is true) —
      // tell the user exactly what to run rather than the old generic
      // message, which was misleading anyway: the catch block used to
      // delete targetDir right after this throw, making "run install
      // manually" impossible (#673).
      throw new Error(
        `Dependency installation failed, but your project files were created.\n` +
          `Finish setup by running:\n\n` +
          `  cd ${workspaceInfo ? workspaceInfo.root : appName}\n` +
          `  ${result.packageManager} install\n`,
      );
    }

    // Initialize a git repository in the newly scaffolded project unless the
    // user opted out with --no-git (or --git false). Defaults to on, matching
    // the behavior most users expect from a scaffolding tool.
    // Skipped in workspace mode: the monorepo already owns the git repo, and
    // a nested repository would hide the app from it.
    if (git !== false && !workspaceInfo) {
      try {
        await execa("git", ["init"], { cwd: targetDir, stdio: "ignore" });
      } catch (error: any) {
        printWarning(
          `Could not initialize git repository (${error?.message || "unknown error"}). ` +
            `You can run \`git init\` yourself later.`,
        );
      }
    }

    void trackScaffoldEvent(
      {
        template: telemetryTemplate,
        language: telemetryLanguage,
        network: telemetryNetwork,
        wallets: telemetryWallets,
        packageManager: finalPackageManager,
        withContracts: !!withContracts,
        skipInstall: !!skipInstall,
        success: true,
        cliVersion: cliVersion || "0.0.0",
        nodeVersion: process.versions.node,
        os: process.platform,
      },
      { noTelemetryFlag: telemetryEnabled === false },
    );

    return buildResult(registered);
  } catch (error) {
    // Only clean up when scaffolding didn't get far enough to leave a
    // usable project behind (#673) — a copy-phase failure leaves nothing
    // worth keeping, but an install-only failure leaves real, valuable
    // work that the user was just told how to finish setting up.
    if (!filesScaffolded && (await fs.pathExists(targetDir))) {
      console.log(
        pc.yellow(`Cleaning up incomplete project directory "${appName}"...`),
      );
      await fs.remove(targetDir);
    }
    void trackScaffoldEvent(
      {
        template: telemetryTemplate,
        language: telemetryLanguage,
        network: telemetryNetwork,
        wallets: telemetryWallets,
        packageManager: finalPackageManager,
        withContracts: !!withContracts,
        skipInstall: !!skipInstall,
        success: false,
        cliVersion: cliVersion || "0.0.0",
        nodeVersion: process.versions.node,
        os: process.platform,
      },
      { noTelemetryFlag: telemetryEnabled === false },
    );
    throw error;
  }
}
