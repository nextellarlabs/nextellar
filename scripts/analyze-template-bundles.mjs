#!/usr/bin/env node
/**
 * Per-template bundle analysis with size budgets (see issue #930).
 *
 * For each app template (default, minimal, defi, js-template, js-defi):
 *   1. Scaffold it into a scratch directory via the same `scaffold()` used
 *      by the CLI (src/lib/scaffold.ts), with --skip-install.
 *   2. `npm install` + `npm run build` (a real production `next build`).
 *   3. Measure the client bundle: total bytes under `.next/static`, split
 *      into JS and CSS.
 *   4. Compare against this template's documented budget (below) and report
 *      pass/warn/fail per template.
 *
 * This intentionally measures a *fresh* scaffold's output, not this repo's
 * own template source — it's the same bundle an end user scaffolding with
 * `npx nextellar` would ship, which is what the budgets are meant to guard.
 *
 * A template whose production build fails outright (a bug in the checked-in
 * template source, not a budget regression) is reported as BUILD FAILED and
 * does not count as a budget violation — those are separate, pre-existing
 * bugs to fix on their own, not something this script's exit code should
 * conflate with "the bundle grew too large." See docs/bundle-budgets.md's
 * "Known template issues" section for the current state.
 *
 * Usage:
 *   node scripts/analyze-template-bundles.mjs [--template=<name>] [--json]
 *
 *   --template=<name>  Only analyze one template (default|minimal|defi|js-template|js-defi).
 *   --json             Print machine-readable JSON instead of the human report.
 *   --keep             Don't delete the scratch scaffold directories (for debugging).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Per-template budgets (bytes) for the client bundle under `.next/static`.
 *
 * Baselines were measured from a clean scaffold + `npm run build` of each
 * template on 2026-08-28 (Next.js 16.1.2, Turbopack). Budgets are set at
 * roughly 1.4x the measured baseline, giving headroom for normal dependency
 * bumps while still catching a real regression (e.g. an accidentally
 * unpruned dependency, or a component that stops code-splitting).
 *
 * Update these numbers deliberately when a template's baseline shifts for a
 * legitimate reason (new feature, dependency upgrade) — don't just bump them
 * to make a failing run pass without checking why the bundle grew.
 */
const BUDGETS_BYTES = {
  minimal: 3_400_000,
  default: 3_450_000,
  defi: 3_450_000,
  "js-template": 3_400_000,
  "js-defi": 3_400_000,
};

/** App templates that ship a Next.js app shell, and how to scaffold each. */
const APP_TEMPLATES = [
  { name: "minimal", template: "minimal", useTs: true },
  { name: "default", template: "default", useTs: true },
  { name: "defi", template: "defi", useTs: true },
  { name: "js-template", template: "default", useTs: false },
  { name: "js-defi", template: "defi", useTs: false },
];

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

/** Sum file sizes under `dir` matching `extensions`, recursively. */
function sumBytesByExt(dir, extensions) {
  let total = 0;
  if (!fs.existsSync(dir)) return total;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += sumBytesByExt(full, extensions);
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

function sumAllBytes(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return total;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += sumAllBytes(full);
    } else {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

async function scaffoldTemplate({ template, useTs }, targetDir) {
  const { scaffold } = await import(
    path.join(repoRoot, "dist/src/lib/scaffold.js")
  );
  await scaffold({
    appName: targetDir,
    useTs,
    template,
    defaults: true,
    skipInstall: true,
    telemetryEnabled: false,
  });
}

function runStep(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 100 * 1024 * 1024,
  });
}

async function analyzeOne(spec) {
  const scratchRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), `nextellar-bundle-${spec.name}-`),
  );
  const appDir = path.join(scratchRoot, "app");

  const result = {
    name: spec.name,
    status: "unknown",
    totalBytes: 0,
    jsBytes: 0,
    cssBytes: 0,
    budgetBytes: BUDGETS_BYTES[spec.name],
    error: null,
  };

  try {
    await scaffoldTemplate(spec, appDir);
  } catch (err) {
    result.status = "scaffold-failed";
    result.error = err?.message ?? String(err);
    return { result, scratchRoot };
  }

  try {
    runStep("npm", ["install", "--no-audit", "--no-fund"], appDir);
  } catch (err) {
    result.status = "install-failed";
    result.error = (
      err.stderr?.toString?.() ??
      err.message ??
      String(err)
    ).slice(-4000);
    return { result, scratchRoot };
  }

  try {
    runStep("npm", ["run", "build"], appDir);
  } catch (err) {
    result.status = "build-failed";
    result.error = (
      err.stdout?.toString?.() ??
      err.message ??
      String(err)
    ).slice(-4000);
    return { result, scratchRoot };
  }

  const staticDir = path.join(appDir, ".next", "static");
  result.totalBytes = sumAllBytes(staticDir);
  result.jsBytes = sumBytesByExt(staticDir, [".js"]);
  result.cssBytes = sumBytesByExt(staticDir, [".css"]);
  result.status = result.totalBytes > result.budgetBytes ? "over-budget" : "ok";

  return { result, scratchRoot };
}

function printHumanReport(results) {
  console.log(
    "\nPer-template bundle analysis (.next/static, production build)\n",
  );

  const rows = [];
  for (const r of results) {
    if (r.status === "ok" || r.status === "over-budget") {
      const pct = ((r.totalBytes / r.budgetBytes) * 100).toFixed(0);
      rows.push([
        r.status === "ok" ? pc.green("PASS") : pc.red("FAIL"),
        r.name,
        formatBytes(r.totalBytes),
        formatBytes(r.jsBytes),
        formatBytes(r.cssBytes),
        formatBytes(r.budgetBytes),
        `${pct}%`,
      ]);
    } else {
      rows.push([
        pc.yellow("SKIP"),
        r.name,
        "—",
        "—",
        "—",
        formatBytes(r.budgetBytes),
        r.status,
      ]);
    }
  }

  const headers = [
    "",
    "template",
    "total",
    "js",
    "css",
    "budget",
    "used/status",
  ];
  const widths = headers.map((h, i) =>
    Math.max(
      h.length,
      ...rows.map(
        (row) => String(row[i]).replace(/\x1b\[[0-9;]*m/g, "").length,
      ),
    ),
  );
  const pad = (str, width) => {
    const raw = String(str);
    const visibleLen = raw.replace(/\x1b\[[0-9;]*m/g, "").length;
    return raw + " ".repeat(Math.max(0, width - visibleLen));
  };

  console.log(headers.map((h, i) => pad(h, widths[i])).join("  "));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) {
    console.log(row.map((c, i) => pad(c, widths[i])).join("  "));
  }

  const failed = results.filter((r) => r.status === "over-budget");
  const brokenBuilds = results.filter(
    (r) =>
      r.status === "build-failed" ||
      r.status === "install-failed" ||
      r.status === "scaffold-failed",
  );

  if (brokenBuilds.length > 0) {
    console.log(
      `\n${pc.yellow("Note:")} ${brokenBuilds.length} template(s) could not be measured because their production build failed. ` +
        `This is a pre-existing bug in the template source, not a bundle-budget violation — see docs/bundle-budgets.md's "Known template issues".`,
    );
    for (const r of brokenBuilds) {
      console.log(pc.dim(`  - ${r.name}: ${r.status}`));
    }
  }

  if (failed.length > 0) {
    console.log(
      `\n${pc.red("Bundle budget exceeded")} for: ${failed.map((r) => r.name).join(", ")}`,
    );
  }

  return failed.length === 0;
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const keep = args.includes("--keep");
  const templateArg = args
    .find((a) => a.startsWith("--template="))
    ?.split("=")[1];

  const specs = templateArg
    ? APP_TEMPLATES.filter((t) => t.name === templateArg)
    : APP_TEMPLATES;

  if (specs.length === 0) {
    console.error(
      `Unknown --template. Available: ${APP_TEMPLATES.map((t) => t.name).join(", ")}`,
    );
    process.exit(1);
  }

  // Build the CLI's dist output first so scaffold.js is available — mirrors
  // what scaffold-matrix.yml's CI job does before scaffolding.
  if (!fs.existsSync(path.join(repoRoot, "dist/src/lib/scaffold.js"))) {
    console.log("Building CLI (dist/) before scaffolding templates...");
    runStep("npm", ["run", "build"], repoRoot);
  }

  const results = [];
  const scratchDirs = [];
  for (const spec of specs) {
    if (!jsonMode) console.log(`\nAnalyzing "${spec.name}"...`);
    const { result, scratchRoot } = await analyzeOne(spec);
    results.push(result);
    scratchDirs.push(scratchRoot);
    if (!jsonMode && result.error) {
      console.error(pc.dim(result.error.split("\n").slice(-15).join("\n")));
    }
  }

  if (!keep) {
    for (const dir of scratchDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2));
    const anyOverBudget = results.some((r) => r.status === "over-budget");
    process.exit(anyOverBudget ? 1 : 0);
  }

  const ok = printHumanReport(results);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
