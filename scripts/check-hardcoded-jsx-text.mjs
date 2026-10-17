#!/usr/bin/env node
/**
 * Lightweight, repo-specific check for hardcoded English UI text added to
 * `src/templates/default/src/components/` (see docs/i18n-audit.md for the
 * full existing inventory this check is meant to stop from growing further).
 *
 * This is NOT a general i18n linter (no locale-catalog cross-referencing, no
 * ICU/plural-form awareness) — it's a narrow static check answering one
 * question: "does this file contain a JSX text node, or a common
 * text-bearing prop (aria-label/placeholder/title/alt), whose value looks
 * like a real English sentence/word rather than a technical token?"
 *
 * Usage:
 *   node scripts/check-hardcoded-jsx-text.mjs              # check everything (reports baseline count)
 *   node scripts/check-hardcoded-jsx-text.mjs --new-only    # only fail on lines not already tracked in the baseline
 *   npm run lint:i18n
 *
 * Not wired into ci.yml as a required check yet: docs/i18n-audit.md's
 * existing ~150-180 strings would make every PR touching these components
 * fail immediately. Once the extraction pass in that doc's "Recommended
 * extraction order" section lands, flip `--new-only` to the default (or
 * make this a required check outright) so it actually gates new hardcoding
 * without blocking on the pre-existing backlog.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const TARGET_DIR = join(REPO_ROOT, "src/templates/default/src/components");
const BASELINE_PATH = join(__dirname, "hardcoded-jsx-text-baseline.json");

const TEXT_PROPS = new Set(["aria-label", "placeholder", "title", "alt"]);

/** Heuristic: does this string look like real English UI copy rather than a technical token? */
function looksLikeUiText(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Pure symbols/punctuation, single characters, or CSS-class-shaped strings
  // ("flex items-center", "text-sm") aren't UI copy.
  if (/^[\s\-_./\\:;,]*$/.test(trimmed)) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  // A string of hyphenated lowercase tokens with no spaces reads as a
  // class list or identifier, not a sentence/word a user reads.
  if (
    /^[a-z0-9-]+(\s[a-z0-9-]+){2,}$/.test(trimmed) &&
    !/[A-Z]/.test(trimmed)
  ) {
    // Still allow short 1-2 word lowercase phrases (e.g. "loading", "retry")
    if (trimmed.split(/\s+/).length > 2) return false;
  }
  return true;
}

function collectSourceFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (!/\.tsx$/.test(entry.name)) continue;
    files.push(join(dir, entry.name));
  }
  return files;
}

function findHardcodedStrings(filePath) {
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const findings = [];

  function lineOf(node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  }

  function visit(node) {
    // JSX text content, e.g. <p>Connect your wallet</p>
    if (ts.isJsxText(node)) {
      const text = node.getText();
      if (looksLikeUiText(text)) {
        findings.push({
          line: lineOf(node),
          text: text.trim(),
          kind: "jsx-text",
        });
      }
    }

    // JSX attributes with text-bearing prop names and a plain string literal value
    if (ts.isJsxAttribute(node) && node.initializer) {
      const propName = node.name.getText();
      if (TEXT_PROPS.has(propName) && ts.isStringLiteral(node.initializer)) {
        const text = node.initializer.text;
        if (looksLikeUiText(text)) {
          findings.push({ line: lineOf(node), text, kind: `prop:${propName}` });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return {};
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

function main() {
  const args = process.argv.slice(2);
  const newOnly = args.includes("--new-only");
  const writeBaseline = args.includes("--write-baseline");

  const files = collectSourceFiles(TARGET_DIR);
  const results = {};
  let total = 0;

  for (const file of files) {
    const relative = file.slice(REPO_ROOT.length + 1);
    const findings = findHardcodedStrings(file);
    if (findings.length > 0) {
      results[relative] = findings;
      total += findings.length;
    }
  }

  if (writeBaseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify(results, null, 2) + "\n");
    console.log(
      `✓ Wrote baseline with ${total} tracked hardcoded strings across ${Object.keys(results).length} files.`,
    );
    return;
  }

  if (!newOnly) {
    console.log(
      `Found ${total} hardcoded UI string(s) across ${Object.keys(results).length} file(s) in ${TARGET_DIR.slice(REPO_ROOT.length + 1)}.`,
    );
    console.log(
      "See docs/i18n-audit.md for the full inventory and extraction plan.",
    );
    console.log(
      "Run with --new-only to fail only on strings not already in the baseline.",
    );
    return;
  }

  const baseline = loadBaseline();
  const newFindings = [];

  for (const [file, findings] of Object.entries(results)) {
    const baselineTexts = new Set(
      (baseline[file] ?? []).map((f) => `${f.line}:${f.text}`),
    );
    for (const finding of findings) {
      const key = `${finding.line}:${finding.text}`;
      if (!baselineTexts.has(key)) {
        newFindings.push({ file, ...finding });
      }
    }
  }

  if (newFindings.length > 0) {
    console.error(
      `\n✖ Found ${newFindings.length} new hardcoded UI string(s) not in the i18n baseline:\n`,
    );
    for (const finding of newFindings) {
      console.error(
        `  ${finding.file}:${finding.line} — "${finding.text}" (${finding.kind})`,
      );
    }
    console.error(
      "\nWrap new UI text in the component's useTranslation() -> t(...) call, add the\n" +
        "key to src/templates/default/src/locales/en.ts, and (if intentionally not\n" +
        "converting yet) run `node scripts/check-hardcoded-jsx-text.mjs --write-baseline`\n" +
        "to accept it into the tracked baseline. See docs/i18n-audit.md.",
    );
    process.exit(1);
  }

  console.log(
    `✓ No new hardcoded UI strings found (${total} pre-existing, tracked in the baseline).`,
  );
}

main();
