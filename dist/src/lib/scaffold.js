import path from "path";
import fs from "fs-extra";
import { runInstall } from "./install.js";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export async function scaffold(options) {
    const { appName, useTs, horizonUrl, sorobanUrl, wallets, skipInstall, packageManager, installTimeout, } = options;
    if (!useTs) {
        throw new Error("JavaScript support is coming soon! Please use TypeScript for now.");
    }
    // Point to source templates
    // Resolve relative to this file's location in either src/lib or dist/src/lib
    const templateDir = path.resolve(__dirname, fs.existsSync(path.resolve(__dirname, "../../templates"))
        ? "../../templates/ts-template" // Development (src/lib -> src/templates)
        : "../../../src/templates/ts-template" // Production (dist/src/lib -> src/templates)
    );
    const targetDir = path.resolve(process.cwd(), appName);
    if (await fs.pathExists(targetDir)) {
        throw new Error(`Directory "${appName}" already exists.`);
    }
    // Copy template
    await fs.copy(templateDir, targetDir, {
        filter: (src) => {
            const basename = path.basename(src);
            return basename !== ".git" && basename !== "node_modules";
        },
        preserveTimestamps: true,
    });
    // --- TEMPLATE SUBSTITUTION LOGIC ---
    const replaceInFile = async (filePath, replacements) => {
        const content = await fs.readFile(filePath, "utf8");
        let newContent = content;
        for (const [key, value] of Object.entries(replacements)) {
            newContent = newContent.replaceAll(key, value);
        }
        await fs.writeFile(filePath, newContent, "utf8");
    };
    // Determine configuration
    const config = {
        "{{APP_NAME}}": appName,
        "{{HORIZON_URL}}": horizonUrl || "https://horizon-testnet.stellar.org",
        "{{SOROBAN_URL}}": sorobanUrl || "https://soroban-testnet.stellar.org",
        "{{NETWORK}}": horizonUrl && horizonUrl.includes("public") ? "PUBLIC" : "TESTNET",
        "{{WALLETS}}": wallets && wallets.length > 0
            ? JSON.stringify(wallets)
            : JSON.stringify(["freighter", "albedo", "lobstr"]),
    };
    console.log(`Resource configuration:`, config);
    console.log(`ℹ️  Injecting configuration...`);
    // Files to update
    const filesToProcess = [
        path.join(targetDir, "package.json"),
        path.join(targetDir, "src/contexts/WalletProvider.tsx"),
        path.join(targetDir, "src/lib/stellar-wallet-kit.ts"),
        path.join(targetDir, "src/hooks/useSorobanContract.ts"), // If we add placeholders there later
    ];
    for (const file of filesToProcess) {
        if (await fs.pathExists(file)) {
            await replaceInFile(file, config);
        }
    }
    console.log(`✔️  Scaffolded "${appName}" from template.`);
    // Run installation
    await runInstall({
        cwd: targetDir,
        skipInstall,
        packageManager,
        timeout: installTimeout,
    });
}
