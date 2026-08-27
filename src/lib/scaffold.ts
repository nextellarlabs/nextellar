import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { detectPackageManager, runInstall } from "./install.js";
import { trackScaffoldEvent } from "./telemetry.js";
import { fileURLToPath } from "url";
import { confirm } from "@clack/prompts";
import { validateHorizonUrl, validateSorobanUrl } from "./validate.js";
import { runPreflight } from "./preflight.js";

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
  packageManager?: "npm" | "yarn" | "pnpm";
  installTimeout?: number;
  telemetryEnabled?: boolean;
  cliVersion?: string;
  force?: boolean;
}

export async function scaffold(options: ScaffoldOptions) {
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
  } = options;

  // Preflight toolchain check (#908): fail fast with guidance when the local
  // Node.js toolchain is too old, instead of crashing mid-install. npm is only
  // required when we will actually install, so skip that check for
  // --skip-install / offline scaffolding.
  const preflight = await runPreflight(undefined, 20, !!skipInstall);
  if (!preflight.ok) {
    for (const failure of preflight.failures) {
      console.error(pc.red(`✖ ${failure}`));
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
  const JS_TEMPLATES: Record<string, string> = {
    default: "js-template",
    defi: "js-defi",
  };
  if (!useTs && !JS_TEMPLATES[templateName]) {
    throw new Error(
      `Template "${templateName}" is not available for JavaScript yet. Please use the default or defi template with --javascript.`,
    );
  }

  const resolvedTemplateName = useTs ? templateName : JS_TEMPLATES[templateName];

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

  const targetDir = path.resolve(process.cwd(), appName);
  const finalPackageManager = detectPackageManager(targetDir, packageManager);

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
      "{{APP_NAME}}": appName,
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
      path.join(targetDir, ".env.example"),
      path.join(targetDir, ".nextellar/config.json"),
    ];

    for (const filePath of filesToProcess) {
      if (await fs.pathExists(filePath)) {
        await replaceInFile(filePath, config);
      }
    }

    console.log(`✔️  Scaffolded "${appName}" from template.`);

    const result = await runInstall({
      cwd: targetDir,
      skipInstall,
      packageManager,
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
          `  cd ${appName}\n` +
          `  ${result.packageManager} install\n`,
      );
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
  } catch (error) {
    // Only clean up when scaffolding didn't get far enough to leave a
    // usable project behind (#673) — a copy-phase failure leaves nothing
    // worth keeping, but an install-only failure leaves real, valuable
    // work that the user was just told how to finish setting up.
    if (!filesScaffolded && (await fs.pathExists(targetDir))) {
      console.log(pc.yellow(`Cleaning up incomplete project directory "${appName}"...`));
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
