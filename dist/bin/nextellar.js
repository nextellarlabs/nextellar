#!/usr/bin/env node
import { Command } from "commander";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs-extra";
import pc from "picocolors";
import gradient from "gradient-string";
import { scaffold } from "../src/lib/scaffold.js";
import { upgrade } from "../src/lib/upgrade.js";
import { runDeploy } from "../src/lib/deploy.js";
import { displaySuccess, NEXTELLAR_LOGO } from "../src/lib/feedback.js";
import { detectPackageManager } from "../src/lib/install.js";
import { runInteractivePrompts } from "../src/lib/prompts.js";
import { getTelemetryStatus, isTelemetryDisabledByEnv, maybeShowTelemetryNotice, setTelemetryEnabled, telemetryConfigPath, } from "../src/lib/telemetry.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// (doctor subcommand is registered later after `program` is created)
// Find package.json regardless of whether we are in src/bin or dist/bin
const findPkg = () => {
    const paths = [
        path.join(__dirname, "../package.json"),
        path.join(__dirname, "../../package.json"),
    ];
    for (const p of paths) {
        if (fs.existsSync(p)) {
            return fs.readJsonSync(p);
        }
    }
    return { version: "0.0.0" }; // Fallback
};
const pkg = findPkg();
const program = new Command();
// Register a dedicated `doctor` subcommand so Commander handles `--json`.
program
    .command("doctor")
    .description("Run environment diagnostics")
    .option("--json", "output results as JSON for CI integration")
    .action(async (cmdOpts) => {
    try {
        const { runDoctor } = await import("../src/lib/doctor.js");
        const exitCode = await runDoctor({ json: !!cmdOpts.json });
        process.exit(exitCode);
    }
    catch (err) {
        console.error("Failed to run doctor:", err?.message || err);
        process.exit(1);
    }
});
// Add subcommand: nextellar add <feature> | nextellar add --list
program
    .command("add [feature]")
    .description("Add a Stellar feature to an existing Next.js project")
    .option("--list", "show all available features")
    .option("--force", "overwrite existing files")
    .option("--skip-install", "skip installing npm dependencies")
    .option("--package-manager <manager>", "npm, yarn, or pnpm")
    .action(async (feature, cmdOpts) => {
    try {
        const { runAdd } = await import("../src/lib/add.js");
        const { listFeatures } = await import("../src/lib/features.js");
        if (cmdOpts.list) {
            const list = listFeatures();
            console.log(pc.bold("Available features:\n"));
            list.forEach(({ id, description }) => {
                console.log(`  ${pc.cyan(id.padEnd(12))} ${pc.dim(description)}`);
            });
            console.log("");
            return;
        }
        if (!feature || feature.trim() === "") {
            console.error("Please specify a feature. Use " + pc.cyan("nextellar add --list") + " to see options.");
            process.exit(1);
        }
        const result = await runAdd(feature, {
            force: cmdOpts.force,
            skipInstall: cmdOpts.skipInstall,
            packageManager: cmdOpts.packageManager,
        });
        if (!result.success) {
            console.error(result.message ?? "Add failed.");
            process.exit(1);
        }
    }
    catch (err) {
        console.error("Add failed:", err?.message || err);
        process.exit(1);
    }
});
program
    .command("telemetry <action>")
    .description("Manage anonymous telemetry settings")
    .action(async (action) => {
    const normalized = action.toLowerCase();
    if (normalized === "status") {
        const status = await getTelemetryStatus();
        console.log(`Telemetry is ${status}.`);
        console.log(`Config: ${telemetryConfigPath}`);
        if (isTelemetryDisabledByEnv()) {
            console.log("NEXTELLAR_TELEMETRY_DISABLED is set, so telemetry is forced off for this environment.");
        }
        return;
    }
    if (normalized === "disable") {
        await setTelemetryEnabled(false);
        console.log("Telemetry disabled.");
        console.log(`Saved to: ${telemetryConfigPath}`);
        return;
    }
    if (normalized === "enable") {
        await setTelemetryEnabled(true);
        console.log("Telemetry enabled.");
        console.log(`Saved to: ${telemetryConfigPath}`);
        return;
    }
    console.error(`Unknown telemetry action \"${action}\". Use: status, enable, disable.`);
    process.exit(1);
});
program
    .command("upgrade")
    .description("Upgrade an existing Nextellar project to the latest template files")
    .option("--dry-run", "Show what would change without applying it", false)
    .option("--yes", "Apply changes without prompting", false)
    .action(async (options) => {
    try {
        await upgrade({ dryRun: options.dryRun, yes: options.yes });
    }
    catch (err) {
        console.error(`\n❌ Error: ${err.message}`);
        process.exit(1);
    }
});
program
    .command("deploy")
    .description("Validate and prepare a deployment bundle for Nextellar Cloud")
    .option("--dry-run", "validate and show what would be deployed without bundling")
    .action(async (cmdOpts) => {
    try {
        await runDeploy({
            cwd: process.cwd(),
            dryRun: !!cmdOpts.dryRun,
        });
    }
    catch (err) {
        console.error(`\n❌ Error: ${err?.message || err}`);
        process.exit(1);
    }
});
program
    .name("nextellar")
    .description("CLI to scaffold a Next.js + Stellar starter")
    .version(pkg.version, "-v, --version", "output the current version")
    .argument("<project-name>", "name of the new Nextellar project")
    .option("-t, --typescript", "generate a TypeScript project (default)", true)
    .option("-j, --javascript", "generate a JavaScript project")
    .option("--template <name>", "project template to use (default, minimal, defi)")
    .option("--horizon-url <url>", "custom Horizon endpoint")
    .option("--soroban-url <url>", "custom Soroban RPC endpoint")
    .option("-w, --wallets <list>", "comma-separated wallet adapters (freighter, xbull)", "")
    .option("-d, --defaults", "skip prompts and use defaults", false)
    .option("--skip-install", "skip dependency installation after scaffolding", false)
    .option("--package-manager <manager>", "choose package manager (npm, yarn, pnpm)")
    .option("-c, --with-contracts", "scaffold Soroban smart contracts alongside the frontend", false)
    .option("--install-timeout <ms>", "installation timeout in milliseconds", "1200000")
    .option("--no-telemetry", "disable telemetry for this invocation");
program.action(async (projectName, options) => {
    const template = options.template || "default";
    const validTemplates = ["default", "minimal", "defi"];
    const useTs = options.typescript && !options.javascript;
    const hasArg = (longFlag, shortFlag) => {
        const argv = process.argv;
        return argv.includes(longFlag) || (shortFlag ? argv.includes(shortFlag) : false);
    };
    const splitWallets = (value) => {
        if (typeof value !== "string")
            return [];
        return value
            .split(",")
            .map((w) => w.trim())
            .filter(Boolean);
    };
    if (!validTemplates.includes(template)) {
        console.error(`Unknown template "${template}". Available: default, minimal, defi`);
        process.exit(1);
    }
    // Clear console and show welcome banner
    if (process.stdout.isTTY) {
        process.stdout.write("\x1Bc");
        console.log(gradient(["#FFFFFF", "#000000"])(NEXTELLAR_LOGO));
        console.log(`\n  ${pc.bold(pc.white("Nextellar CLI"))} ${pc.dim(`v${pkg.version}`)}`);
        console.log(`  ${pc.dim("Modern Next.js + Stellar toolkit")}\n`);
        console.log(`  ${pc.magenta("◆")} Project: ${pc.cyan(projectName)}`);
        console.log(`  ${pc.magenta("◆")} Type:    ${pc.cyan(useTs ? "TypeScript" : "JavaScript")}`);
        console.log(`  ${pc.magenta("◆")} Template: ${pc.cyan(template)}`);
        console.log(`  ${pc.magenta("◆")} Contracts: ${pc.cyan(options.withContracts ? "Yes" : "No")}\n`);
    }
    const shouldPrompt = !options.defaults &&
        process.stdout.isTTY &&
        process.stdin.isTTY &&
        !process.env.CI;
    const defaultWallets = ["freighter", "albedo", "lobstr"];
    const walletsFlagProvided = hasArg("--wallets", "-w");
    const networkFlagProvided = hasArg("--horizon-url") || hasArg("--soroban-url");
    const packageManagerFlagProvided = hasArg("--package-manager");
    const skipInstallFlagProvided = hasArg("--skip-install");
    let finalProjectName = projectName;
    let finalHorizonUrl = options.horizonUrl;
    let finalSorobanUrl = options.sorobanUrl;
    let finalWallets = walletsFlagProvided
        ? splitWallets(options.wallets)
        : [];
    let finalPackageManager = options
        .packageManager;
    let finalSkipInstall = options.skipInstall;
    if (shouldPrompt) {
        const promptResult = await runInteractivePrompts({
            initialProjectName: projectName,
            cwd: process.cwd(),
            defaultWallets,
            packageManagerFromFlag: options.packageManager,
            networkFlagProvided,
            walletsFlagProvided,
            packageManagerFlagProvided,
            skipInstallFlagProvided,
        });
        if (!promptResult) {
            process.exit(0);
        }
        finalProjectName = promptResult.projectName;
        if (!networkFlagProvided) {
            finalHorizonUrl = promptResult.horizonUrl;
            finalSorobanUrl = promptResult.sorobanUrl;
        }
        if (!walletsFlagProvided) {
            finalWallets = promptResult.wallets ?? defaultWallets;
        }
        if (!packageManagerFlagProvided) {
            finalPackageManager = promptResult.packageManager;
        }
        if (!skipInstallFlagProvided) {
            finalSkipInstall = !!promptResult.skipInstall;
        }
    }
    else {
        finalWallets = walletsFlagProvided ? finalWallets : defaultWallets;
    }
    try {
        await maybeShowTelemetryNotice({ noTelemetryFlag: options.telemetry === false });
        await scaffold({
            appName: finalProjectName,
            useTs,
            template,
            withContracts: options.withContracts,
            horizonUrl: finalHorizonUrl,
            sorobanUrl: finalSorobanUrl,
            wallets: finalWallets,
            defaults: options.defaults,
            skipInstall: finalSkipInstall,
            packageManager: finalPackageManager,
            installTimeout: parseInt(options.installTimeout),
            telemetryEnabled: options.telemetry,
            cliVersion: pkg.version,
        });
        const pkgManager = detectPackageManager(path.join(process.cwd(), finalProjectName), finalPackageManager);
        await displaySuccess(finalProjectName, pkgManager, finalSkipInstall);
    }
    catch (err) {
        console.error(`\n❌ Error: ${err.message}`);
        process.exit(1);
    }
});
program.parse(process.argv);
