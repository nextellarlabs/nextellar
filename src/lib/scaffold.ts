import path from "path";
import fs from "fs-extra";

export interface ScaffoldOptions {
  appName: string;
  useTs: boolean;
  horizonUrl?: string;
  sorobanUrl?: string;
  wallets?: string[];
  defaults?: boolean;
}

export async function scaffold(options: ScaffoldOptions) {
  const { appName } = options;

  const templateDir = path.resolve(__dirname, "../templates/ts-template");
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
}
