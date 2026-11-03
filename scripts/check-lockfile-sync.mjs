#!/usr/bin/env node
/**
 * Fails fast when package-lock.json no longer matches package.json (#795),
 * before `npm ci` fails with a less obvious "Missing: ... from lock file".
 *
 *   node scripts/check-lockfile-sync.mjs [dir]   # default: repo root
 *   npm run check:lockfile
 *
 * Needs no installed dependencies, so CI runs it ahead of `npm ci`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkLockfileSync,
  formatLockfileReport,
} from "./lib/lockfile-sync.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.resolve(ROOT, process.argv[2] ?? ".");

const read = (file) => {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) {
    console.error(`${path.relative(ROOT, full) || file} not found.`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (err) {
    console.error(`Could not parse ${file}: ${err.message}`);
    process.exit(1);
  }
};

const result = checkLockfileSync(read("package.json"), read("package-lock.json"));
const report = formatLockfileReport(result);
if (result.ok) {
  console.log(report);
} else {
  console.error(report);
  process.exit(1);
}
