/**
 * Pure check that package-lock.json still matches package.json (#795).
 *
 * `npm ci` refuses to install when they disagree ("Missing: <pkg>@<version>
 * from lock file"), which breaks the install step of every CI job at once.
 * This reproduces the cases npm ci rejects most often, without needing
 * node_modules or network access, so CI can fail fast with a readable
 * message and contributors can run it before pushing.
 *
 * Kept free of I/O so tests/lockfile-sync.test.ts can exercise it directly.
 */

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

/**
 * @param {Record<string, any>} pkg parsed package.json
 * @param {Record<string, any>} lock parsed package-lock.json (lockfileVersion 2 or 3)
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function checkLockfileSync(pkg, lock) {
  const problems = [];

  if (!lock || typeof lock !== "object" || !lock.packages) {
    return {
      ok: false,
      problems: [
        "package-lock.json has no `packages` map (lockfileVersion 2+ required). Regenerate it with `npm install --package-lock-only`.",
      ],
    };
  }

  const root = lock.packages[""];
  if (!root) {
    return {
      ok: false,
      problems: ["package-lock.json is missing its root package entry."],
    };
  }

  if (pkg.name && lock.name && pkg.name !== lock.name) {
    problems.push(
      `name differs: package.json "${pkg.name}" vs package-lock.json "${lock.name}".`,
    );
  }

  for (const field of DEP_FIELDS) {
    const declared = pkg[field] || {};
    const locked = root[field] || {};

    for (const [name, range] of Object.entries(declared)) {
      if (!(name in locked)) {
        problems.push(
          `${field}: "${name}@${range}" is in package.json but missing from package-lock.json.`,
        );
      } else if (locked[name] !== range) {
        problems.push(
          `${field}: "${name}" is "${range}" in package.json but "${locked[name]}" in package-lock.json.`,
        );
      }

      // peerDependencies are not necessarily installed at the top level.
      if (field !== "peerDependencies") {
        const entry = lock.packages[`node_modules/${name}`];
        if (!entry && !isWorkspaceLink(lock, name)) {
          problems.push(
            `${field}: "${name}" has no "node_modules/${name}" entry in package-lock.json (npm ci: Missing: ${name} from lock file).`,
          );
        }
      }
    }

    for (const name of Object.keys(locked)) {
      if (!(name in declared)) {
        problems.push(
          `${field}: "${name}" is in package-lock.json but no longer in package.json.`,
        );
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

function isWorkspaceLink(lock, name) {
  const entry = lock.packages[`node_modules/${name}`];
  return Boolean(entry && entry.link);
}

/** Human-readable report for the CLI and CI logs. */
export function formatLockfileReport(result) {
  if (result.ok) return "package-lock.json is in sync with package.json.";
  return [
    "package-lock.json is out of sync with package.json; `npm ci` will fail:",
    ...result.problems.map((p) => `  - ${p}`),
    "",
    "Fix: run `npm install --package-lock-only` (no unrelated upgrades) and commit package-lock.json.",
  ].join("\n");
}
