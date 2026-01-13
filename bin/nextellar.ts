#!/usr/bin/env node
import { Command } from "commander";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs-extra";
import pc from "picocolors";
import gradient from "gradient-string";
import { scaffold } from "../src/lib/scaffold.js";
import { displaySuccess, NEXTELLAR_LOGO } from "../src/lib/feedback.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

program
  .name("nextellar")
  .description("CLI to scaffold a Next.js + Stellar starter")
  .version(pkg.version, "-v, --version", "output the current version")
  .argument("<project-name>", "name of the new Nextellar project")
  .option("-t, --typescript", "generate a TypeScript project (default)", true)
  .option("-j, --javascript", "generate a JavaScript project")
  .option("--horizon-url <url>", "custom Horizon endpoint")
  .option("--soroban-url <url>", "custom Soroban RPC endpoint")
  .option(
    "-w, --wallets <list>",
    "comma-separated wallet adapters (freighter, xbull)",
    ""
  )
  .option("-d, --defaults", "skip prompts and use defaults", false)
  .option(
    "--skip-install",
    "skip dependency installation after scaffolding",
    false
  )
  .option(
    "--package-manager <manager>",
    "choose package manager (npm, yarn, pnpm)"
  )
  .option(
    "--install-timeout <ms>",
    "installation timeout in milliseconds",
    "1200000"
  );

program.action(async (projectName, options) => {
  // Clear console and show welcome banner
  if (process.stdout.isTTY) {
    process.stdout.write("\x1Bc");
    console.log(gradient(["#4c30e2", "#4c30e2", "#FFFFFF"])(NEXTELLAR_LOGO));
    console.log(
      `\n  ${pc.bold(pc.white("Nextellar CLI"))} ${pc.dim(`v${pkg.version}`)}`
    );
    console.log(`  ${pc.dim("Modern Next.js + Stellar toolkit")}\n`);
    console.log(`  ${pc.magenta("◆")} Project: ${pc.cyan(projectName)}`);
    console.log(`  ${pc.magenta("◆")} Type:    ${pc.cyan("TypeScript")}\n`);
  }

  const useTs = options.typescript && !options.javascript;
  const wallets = options.wallets ? options.wallets.split(",") : [];
  try {
    await scaffold({
      appName: projectName,
      useTs,
      horizonUrl: options.horizonUrl,
      sorobanUrl: options.sorobanUrl,
      wallets,
      defaults: options.defaults,
      skipInstall: options.skipInstall,
      packageManager: options.packageManager,
      installTimeout: parseInt(options.installTimeout),
    });

    if (options.skipInstall) {
      console.log("\n✅ Your Nextellar app is ready!");
      console.log(`   cd ${projectName}`);
      console.log("   npm install");
      console.log("   npm run dev");
    } else {
      await displaySuccess(projectName);
    }
  } catch (err: any) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
});

program.parse(process.argv);
