#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const forbidden = [
  "node_modules",
  ".next",
  ".turbo",
  "coverage",
];

try {
  const files = execFileSync("git", ["ls-files", "src/templates"], {
    encoding: "utf8",
  });

  const offenders = files
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((file) =>
      forbidden.some((dir) => file.includes(`/${dir}/`) || file.includes(`\\${dir}\\`))
    );

  if (offenders.length > 0) {
    console.error("\n Forbidden generated files found under src/templates:\n");
    offenders.forEach((file) => console.error(`  ${file}`));
    console.error(
      "\nRemove these generated directories before committing."
    );
    process.exit(1);
  }

  console.log("✓ No generated template artifacts found.");
} catch (err) {
  console.error(err.message);
  process.exit(1);
}