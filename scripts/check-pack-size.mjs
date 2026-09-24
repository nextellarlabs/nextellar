#!/usr/bin/env node
/**
 * Validates npm pack output against size limits (see .github/workflows/ci.yml).
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Packed tarball size limit (bytes). ~2× clean main. */
const MAX_PACK_BYTES = 5 * 1024 * 1024;
/** Unpacked size limit (bytes). ~2× clean main. */
const MAX_UNPACKED_BYTES = 25 * 1024 * 1024;
/** Max file entries in the tarball. ~2× clean main. */
const MAX_ENTRY_COUNT = 1000;

const TOP_N = 20;

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes} B`;
}

function parsePackOutput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("npm pack --dry-run --json produced no output");
  }
  const parsed = JSON.parse(trimmed);
  if (Array.isArray(parsed)) {
    return parsed[0];
  }
  return parsed;
}

function main() {
  let raw;
  try {
    raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = err.stderr?.toString?.() ?? "";
    console.error("Failed to run npm pack --dry-run --json");
    if (stderr) {
      console.error(stderr);
    }
    process.exit(1);
  }

  const pack = parsePackOutput(raw);
  const size = pack.size ?? 0;
  const unpackedSize = pack.unpackedSize ?? 0;
  const entryCount = pack.entryCount ?? pack.files?.length ?? 0;
  const files = Array.isArray(pack.files) ? pack.files : [];

  const violations = [];
  if (size > MAX_PACK_BYTES) {
    violations.push(
      `packed size ${formatBytes(size)} exceeds limit ${formatBytes(MAX_PACK_BYTES)}`,
    );
  }
  if (unpackedSize > MAX_UNPACKED_BYTES) {
    violations.push(
      `unpacked size ${formatBytes(unpackedSize)} exceeds limit ${formatBytes(MAX_UNPACKED_BYTES)}`,
    );
  }
  if (entryCount > MAX_ENTRY_COUNT) {
    violations.push(
      `entry count ${entryCount} exceeds limit ${MAX_ENTRY_COUNT}`,
    );
  }

  console.log(
    `npm pack: ${formatBytes(size)} packed, ${formatBytes(unpackedSize)} unpacked, ${entryCount} entries`,
  );

  if (violations.length === 0) {
    return;
  }

  console.error("npm pack size guard failed:");
  for (const line of violations) {
    console.error(`  - ${line}`);
  }

  const largest = [...files]
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
    .slice(0, TOP_N);

  if (largest.length > 0) {
    console.error(`\nLargest ${Math.min(TOP_N, largest.length)} entries:`);
    for (const file of largest) {
      const filePath = file.path ?? file.name ?? "(unknown)";
      console.error(`  ${formatBytes(file.size ?? 0).padStart(10)}  ${filePath}`);
    }
  }

  process.exit(1);
}

main();
