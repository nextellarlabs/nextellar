import path from "path";
import fs from "fs-extra";
import { detectPackageManager, runInstall } from "./install.js";
import { trackScaffoldEvent } from "./telemetry.js";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export async function scaffold(options) {
    const { appName, useTs, template, withContracts, horizonUrl, sorobanUrl, wallets, skipInstall, packageManager, installTimeout, telemetryEnabled, cliVersion, } = options;
    const telemetryTemplate = template || "default";
    const telemetryLanguage = useTs ? "typescript" : "javascript";
    const telemetryNetwork = horizonUrl && horizonUrl.includes("public") ? "public" : "testnet";
    const telemetryWallets = wallets && wallets.length > 0 ? wallets : ["freighter", "albedo", "lobstr"];
    const templateName = template || "default";
    if (!useTs && templateName !== "default") {
        throw new Error(`Template "${templateName}" is not available for JavaScript yet. Please use the default template with --javascript.`);
    }
    const resolvedTemplateName = useTs ? templateName : "js-template";
    // Resolve templates across src/dist and nested workspace layouts.
    const templateRoots = [
        path.resolve(__dirname, "../templates"),
        path.resolve(__dirname, "../../templates"),
        path.resolve(__dirname, "../../../src/templates"),
        path.resolve(__dirname, "../../nextellar/src/templates"),
        path.resolve(__dirname, "../../../nextellar/src/templates"),
    ];
    const templateRoot = templateRoots.find((candidate) => fs.existsSync(path.join(candidate, resolvedTemplateName, "package.json"))) || templateRoots[templateRoots.length - 1];
    const templateDir = path.join(templateRoot, resolvedTemplateName);
    const targetDir = path.resolve(process.cwd(), appName);
    const finalPackageManager = detectPackageManager(targetDir, packageManager);
    if (await fs.pathExists(targetDir)) {
        throw new Error(`Directory "${appName}" already exists.`);
    }
    try {
        await fs.copy(templateDir, targetDir, {
            filter: (src) => {
                const basename = path.basename(src);
                return basename !== ".git" && basename !== "node_modules";
            },
            preserveTimestamps: true,
        });
        if (withContracts) {
            const contractsTemplateDir = path.join(templateRoot, "contracts-template");
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
            await fs.appendFile(envExamplePath, `\n# Soroban Smart Contracts\nNEXT_PUBLIC_HELLO_WORLD_CONTRACT_ID=C_REPLACE_WITH_YOUR_CONTRACT_ID\n`);
        }
        const replaceInFile = async (filePath, replacements) => {
            const content = await fs.readFile(filePath, "utf8");
            let newContent = content;
            for (const [key, value] of Object.entries(replacements)) {
                newContent = newContent.replaceAll(key, value);
            }
            await fs.writeFile(filePath, newContent, "utf8");
        };
        const config = {
            "{{APP_NAME}}": appName,
            "{{HORIZON_URL}}": horizonUrl || "https://horizon-testnet.stellar.org",
            "{{SOROBAN_URL}}": sorobanUrl || "https://soroban-testnet.stellar.org",
            "{{NETWORK}}": horizonUrl && horizonUrl.includes("public") ? "PUBLIC" : "TESTNET",
            "{{WALLETS}}": wallets && wallets.length > 0
                ? JSON.stringify(wallets)
                : JSON.stringify(["freighter", "albedo", "lobstr"]),
            "{{NEXTELLAR_VERSION}}": cliVersion ||
                (() => {
                    try {
                        const pkgPath = fs.existsSync(path.resolve(__dirname, "../../package.json"))
                            ? path.resolve(__dirname, "../../package.json")
                            : path.resolve(__dirname, "../../../package.json");
                        const myPkg = fs.readJsonSync(pkgPath);
                        return myPkg.version || "0.0.0";
                    }
                    catch {
                        return "0.0.0";
                    }
                })(),
            "{{TEMPLATE_NAME}}": templateName,
            "{{TIMESTAMP}}": new Date().toISOString(),
        };
        const filesToProcess = [
            path.join(targetDir, "package.json"),
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
            throw new Error(`Dependency installation failed. Please run "${result.packageManager} install" manually in "${appName}".`);
        }
        void trackScaffoldEvent({
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
        }, { noTelemetryFlag: telemetryEnabled === false });
    }
    catch (error) {
        void trackScaffoldEvent({
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
        }, { noTelemetryFlag: telemetryEnabled === false });
        throw error;
    }
}
