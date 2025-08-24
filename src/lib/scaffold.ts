import path from "path";
import fs from "fs-extra";
import { runInstall } from "./install.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ScaffoldOptions {
  appName: string;
  useTs: boolean;
  horizonUrl?: string;
  sorobanUrl?: string;
  wallets?: string[];
  defaults?: boolean;
  skipInstall?: boolean;
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  installTimeout?: number;
}

export async function scaffold(options: ScaffoldOptions) {
  const { appName, skipInstall, packageManager, installTimeout } = options;

  // Point to source templates (from dist/src/lib/ to src/templates/)
  const templateDir = path.resolve(__dirname, "../../../src/templates/ts-template");
  const targetDir = path.resolve(process.cwd(), appName);

  if (await fs.pathExists(targetDir)) {
    throw new Error(`Directory "${appName}" already exists.`);
  }

  await fs.copy(templateDir, targetDir, {
    filter: (src) => {
      const basename = path.basename(src);
      return basename !== ".git" && basename !== "node_modules";
    },
    preserveTimestamps: true,
  });

  console.log(`✔️  Scaffolded "${appName}" from template.`);

  // Run installation
  await runInstall({
    cwd: targetDir,
    skipInstall,
    packageManager,
    timeout: installTimeout,
  });
}
