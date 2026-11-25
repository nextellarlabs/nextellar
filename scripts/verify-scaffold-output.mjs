#!/usr/bin/env node
/**
 * Verifies a scaffolded app directory (#1492).
 *
 * Used by the Windows long-path job in .github/workflows/scaffold-matrix.yml, where the app is
 * scaffolded into a deeply nested directory addressed with backslashes. Checks that:
 *   - placeholder replacement ran: no `{{NAME}}`-style token is left in any text file, and
 *     package.json carries the app name;
 *   - .gitignore handling ran: the file exists, is not empty and ignores node_modules.
 *
 * Usage: node scripts/verify-scaffold-output.mjs <app-dir> <app-name> [--min-path-length=N]
 * Exits 1 with one line per problem.
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const [appDir, appName] = args.filter((a) => !a.startsWith("--"));

if (!appDir || !appName) {
  console.error(
    "usage: verify-scaffold-output.mjs <app-dir> <app-name> [--min-path-length=N]",
  );
  process.exit(2);
}

const minPathLength = Number(
  (flags.find((f) => f.startsWith("--min-path-length=")) ?? "").split("=")[1] ||
    0,
);

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".toml",
  ".env",
  ".example",
  ".txt",
  ".rs",
]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".next"]);
const PLACEHOLDER = /\{\{[A-Z][A-Z0-9_]*\}\}/;

const problems = [];
const root = path.resolve(appDir);

if (root.length < minPathLength) {
  problems.push(
    `app path is ${root.length} characters, expected at least ${minPathLength}: the long-path case is not being exercised`,
  );
}
if (!fs.existsSync(root)) {
  console.error(`scaffold output not found: ${root}`);
  process.exit(1);
}

let longest = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    longest = Math.max(longest, full.length);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full);
      continue;
    }
    const ext = path.extname(entry.name);
    if (
      !TEXT_EXT.has(ext) &&
      !TEXT_EXT.has(`.${entry.name.replace(/^\./, "")}`)
    ) {
      continue;
    }
    const text = fs.readFileSync(full, "utf8");
    const hit = text.match(PLACEHOLDER);
    if (hit)
      problems.push(
        `unreplaced placeholder ${hit[0]} in ${path.relative(root, full)}`,
      );
  }
}
walk(root);

const pkgPath = path.join(root, "package.json");
if (!fs.existsSync(pkgPath)) {
  problems.push("package.json is missing");
} else if (JSON.parse(fs.readFileSync(pkgPath, "utf8")).name !== appName) {
  problems.push(`package.json name is not "${appName}"`);
}

const gitignore = path.join(root, ".gitignore");
if (!fs.existsSync(gitignore)) {
  problems.push(".gitignore is missing");
} else if (
  !/^\/?node_modules\/?\s*$/m.test(fs.readFileSync(gitignore, "utf8"))
) {
  problems.push(".gitignore does not ignore node_modules");
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log(`ok: ${root} (longest path ${longest} characters)`);
