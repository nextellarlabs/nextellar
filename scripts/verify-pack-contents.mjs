import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

// package.json's `files` allowlist is the package boundary. Keep these checks
// focused on files that must ship and directories that must stay private.
function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

const templateEntries = listFiles("src/templates")
  .filter(
    (entry) =>
      path.basename(entry) === ".env.example" ||
      (path.basename(path.dirname(entry)) === "hooks" &&
        [".js", ".ts"].includes(path.extname(entry))),
  )
  .map((entry) => entry.replaceAll(path.sep, "/"));

const requiredEntries = ["dist/bin/nextellar.js", ...templateEntries];

const forbiddenDirectories = ["tests", "backend", "routes-d"];
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? process.env.ComSpec ?? "cmd.exe" : "npm";
const npmArgs = isWindows
  ? ["/d", "/s", "/c", "npm pack --dry-run --json"]
  : ["pack", "--dry-run", "--json"];

const packJson = execFileSync(npmCommand, npmArgs, {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});

const packResult = JSON.parse(packJson);
const packedEntries = new Set(
  packResult.flatMap(({ files = [] }) =>
    files.map(({ path }) => path.replaceAll("\\", "/")),
  ),
);

const missingEntries = requiredEntries.filter(
  (entry) => !packedEntries.has(entry),
);
const forbiddenEntries = [...packedEntries].filter((entry) =>
  forbiddenDirectories.some(
    (directory) => entry === directory || entry.startsWith(`${directory}/`),
  ),
);

if (missingEntries.length || forbiddenEntries.length) {
  const failures = [];

  if (missingEntries.length) {
    failures.push(`Missing required entries:\n${missingEntries.join("\n")}`);
  }

  if (forbiddenEntries.length) {
    failures.push(`Forbidden entries:\n${forbiddenEntries.join("\n")}`);
  }

  console.error(failures.join("\n\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Pack contents verified: ${packedEntries.size} entries; required template hooks, environment examples, and CLI binary are present.`,
  );
}
