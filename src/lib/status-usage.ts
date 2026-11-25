import path from "node:path";
import fs from "fs-extra";
import { getFeature, getFeatureIds } from "./features.js";
import { defaultTemplatesRoot, getTemplate } from "./templates.js";

export interface StatusUsage {
  template: string;
  language: "typescript" | "javascript" | null;
  features: string[];
  drift: {
    modified: string[];
    missing: string[];
  } | null;
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.lstat(dir)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function sourceFiles(root: string): Promise<Set<string>> {
  const files = new Set<string>();
  async function visit(relative: string): Promise<void> {
    const entries = await fs.readdir(path.join(root, relative), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) files.add(file);
    }
  }

  if (await isDirectory(path.join(root, "src"))) await visit("src");
  return files;
}

const scaffoldValues = {
  "{{NETWORK}}": "(?:PUBLIC|TESTNET)",
  "{{WALLETS}}": String.raw`\[[^\]\r\n]*\]`,
  "{{SOROBAN_URL}}": String.raw`[^'"\r\n]+`,
} as const;
const scaffoldToken = /(\{\{(?:NETWORK|WALLETS|SOROBAN_URL)\}\})/;

function matchesStarter(
  actual: Buffer,
  starter: Buffer,
  file: string,
): boolean {
  if (!/\.(?:[jt]sx?|css)$/.test(file)) return actual.equals(starter);

  const actualLines = actual.toString("utf8").split(/\r?\n/);
  const starterLines = starter.toString("utf8").split(/\r?\n/);
  return (
    actualLines.length === starterLines.length &&
    starterLines.every((line, index) => {
      if (line === actualLines[index]) return true;
      if (!scaffoldToken.test(line)) return false;
      // Match the scaffold's substitutions in place. The rest of each line
      // still has to match, including any code next to the configured value.
      const pattern = line
        .split(scaffoldToken)
        .map((part, i) =>
          i % 2 === 0
            ? part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            : scaffoldValues[part as keyof typeof scaffoldValues],
        )
        .join("");
      return new RegExp(`^${pattern}$`).test(actualLines[index]);
    })
  );
}

export async function collectStatusUsage(
  cwd: string,
  templateName: string,
): Promise<StatusUsage> {
  const projectFiles = await sourceFiles(cwd);
  const language = (await fs.pathExists(path.join(cwd, "tsconfig.json")))
    ? "typescript"
    : (await fs.pathExists(path.join(cwd, "jsconfig.json")))
      ? "javascript"
      : null;

  const features = getFeatureIds()
    .filter((id) => {
      const files = getFeature(id)?.files ?? [];
      // Some starters have wallet support without the optional memo helper.
      const required =
        id === "wallet"
          ? files.filter((file) => file !== "lib/memo.ts")
          : files;
      return (
        required.length > 0 &&
        required.every((file) => {
          const relative = `src/${file}`;
          return (
            projectFiles.has(relative) ||
            (language === "javascript" &&
              projectFiles.has(relative.replace(/\.ts(x?)$/, ".js$1")))
          );
        })
      );
    })
    .sort();
  const usage: StatusUsage = {
    template: templateName,
    language,
    features,
    drift: null,
  };

  const template = getTemplate(templateName);
  if (!template || !language) return usage;
  const isTypeScript = language === "typescript";
  const base = isTypeScript ? template.tsDir : template.jsDir;
  if (!base) return usage;

  const templatesRoot = defaultTemplatesRoot();
  const overlay = isTypeScript ? template.tsOverlayDir : template.jsOverlayDir;
  const contracts =
    template.withContracts || (await isDirectory(path.join(cwd, "contracts")));
  const layers = [base, overlay, contracts ? "contracts-template" : undefined];
  const baseline = new Map<string, string>();
  for (const layer of layers) {
    if (!layer) continue;
    const root = path.join(templatesRoot, layer);
    if (!(await isDirectory(root))) return usage;
    for (const file of await sourceFiles(root)) {
      baseline.set(file, path.join(root, file));
    }
  }
  if (baseline.size === 0) return usage;

  const modified: string[] = [];
  const missing: string[] = [];
  for (const [file, starterFile] of baseline) {
    if (!projectFiles.has(file)) {
      missing.push(file);
      continue;
    }
    const [actual, starter] = await Promise.all([
      fs.readFile(path.join(cwd, file)),
      fs.readFile(starterFile),
    ]);
    if (!matchesStarter(actual, starter, file)) modified.push(file);
  }
  usage.drift = { modified: modified.sort(), missing: missing.sort() };
  return usage;
}
