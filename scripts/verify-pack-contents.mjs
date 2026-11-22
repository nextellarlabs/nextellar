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

const templateFiles = listFiles("src/templates").map((entry) =>
  entry.replaceAll(path.sep, "/"),
);
const hookEntries = templateFiles.filter(
  (entry) =>
    path.posix.basename(path.posix.dirname(entry)) === "hooks" &&
    [".js", ".ts"].includes(path.posix.extname(entry)),
);
const envExampleEntries = templateFiles.filter(
  (entry) => path.posix.basename(entry) === ".env.example",
);

// An empty walk would make the required list vacuous and the guard a no-op.
if (!hookEntries.length || !envExampleEntries.length) {
  console.error(
    `Template discovery failed: found ${hookEntries.length} hook file(s) and ${envExampleEntries.length} .env.example file(s) under src/templates; expected at least one of each.`,
  );
  process.exit(1);
}

const templateEntries = [...hookEntries, ...envExampleEntries];

// Every template ships .nextellar/config.json; require it per template so a
// missing or ignored file cannot slip through the walk above.
const configEntries = readdirSync("src/templates", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `src/templates/${entry.name}/.nextellar/config.json`);

const requiredEntries = [
  "dist/bin/nextellar.js",
  ...templateEntries,
  ...configEntries,
];

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

const packedHooks = hookEntries.filter((entry) => packedEntries.has(entry));
const packedEnvExamples = envExampleEntries.filter((entry) =>
  packedEntries.has(entry),
);

const missingEntries = requiredEntries.filter(
  (entry) => !packedEntries.has(entry),
);
const forbiddenEntries = [...packedEntries].filter((entry) =>
  forbiddenDirectories.some(
    (directory) => entry === directory || entry.startsWith(`${directory}/`),
  ),
);

if (
  missingEntries.length ||
  forbiddenEntries.length ||
  !packedHooks.length ||
  !packedEnvExamples.length
) {
  const failures = [];

  if (!packedHooks.length) {
    failures.push("No template hooks found in npm pack output.");
  }

  if (!packedEnvExamples.length) {
    failures.push("No .env.example files found in npm pack output.");
  }

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
    `Pack contents verified: ${packedEntries.size} entries; required template hooks, environment examples, .nextellar/config.json files, and CLI binary are present.`,
  );
}
