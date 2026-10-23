#!/usr/bin/env node
/**
 * Summarises the Stryker mutation report for the src/lib pilot (#1088).
 *
 *   node scripts/mutation-score.mjs                     # print scores
 *   node scripts/mutation-score.mjs --write-baseline    # record docs/mutation-baseline.json
 *   node scripts/mutation-score.mjs --check             # exit 1 on a regression vs the baseline
 *
 * Options: --report <path> (default reports/mutation/mutation.json),
 *          --baseline <path> (default docs/mutation-baseline.json),
 *          --tolerance <points> (default 1).
 *
 * Run `npm run test:mutation` first to produce the report.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeMutationScore,
  compareToBaseline,
  formatScoreTable,
  toBaseline,
} from "./lib/mutation-score.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const reportPath = path.resolve(
  ROOT,
  opt("--report", "reports/mutation/mutation.json"),
);
const baselinePath = path.resolve(
  ROOT,
  opt("--baseline", "docs/mutation-baseline.json"),
);
const tolerance = Number(opt("--tolerance", "1"));

if (!fs.existsSync(reportPath)) {
  console.error(
    `No mutation report at ${path.relative(ROOT, reportPath)}. Run \`npm run test:mutation\` first.`,
  );
  process.exit(1);
}

let result;
try {
  result = computeMutationScore(JSON.parse(fs.readFileSync(reportPath, "utf8")));
} catch (err) {
  console.error(`Could not read mutation report: ${err.message}`);
  process.exit(1);
}

const table = formatScoreTable(result);
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## Mutation score (src/lib)\n\n${table}\n`,
  );
}

if (args.includes("--write-baseline")) {
  const baseline = toBaseline(result, new Date().toISOString());
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`\nBaseline written to ${path.relative(ROOT, baselinePath)}.`);
  process.exit(0);
}

const baseline = fs.existsSync(baselinePath)
  ? JSON.parse(fs.readFileSync(baselinePath, "utf8"))
  : null;
const comparison = compareToBaseline(result, baseline, tolerance);
console.log(
  `\nBaseline comparison: ${comparison.status}` +
    (comparison.delta === null ? "" : ` (${comparison.delta} points)`),
);

if (args.includes("--check") && comparison.status === "regressed") {
  process.exit(1);
}
