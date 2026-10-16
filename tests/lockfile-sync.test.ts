/**
 * package-lock.json / package.json sync guard (#795).
 *
 * The last test runs against the real repo files, so a future
 * package.json edit without a matching lockfile update (the
 * "Missing: @types/pngjs@6.0.5 from lock file" failure) breaks `npm test`
 * locally instead of every CI install step.
 */
import { describe, it, expect } from "@jest/globals";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import {
  checkLockfileSync,
  formatLockfileReport,
} from "../scripts/lib/lockfile-sync.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const pkg = {
  name: "demo",
  dependencies: { a: "^1.0.0" },
  devDependencies: { "@types/b": "^6.0.5" },
};

const lock = () => ({
  name: "demo",
  lockfileVersion: 3,
  packages: {
    "": {
      name: "demo",
      dependencies: { a: "^1.0.0" },
      devDependencies: { "@types/b": "^6.0.5" },
    },
    "node_modules/a": { version: "1.2.0" },
    "node_modules/@types/b": { version: "6.0.5", dev: true },
  },
});

describe("checkLockfileSync", () => {
  it("passes when the lockfile matches", () => {
    expect(checkLockfileSync(pkg, lock())).toEqual({ ok: true, problems: [] });
  });

  it("flags a dependency declared in package.json but missing from the lock (#795)", () => {
    const l = lock();
    delete (l.packages[""].devDependencies as Record<string, string>)[
      "@types/b"
    ];
    delete (l.packages as Record<string, unknown>)["node_modules/@types/b"];

    const result = checkLockfileSync(pkg, l);

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"@types/b@^6.0.5" is in package.json but missing'),
        expect.stringContaining("Missing: @types/b from lock file"),
      ]),
    );
  });

  it("flags a range that changed in package.json only", () => {
    const result = checkLockfileSync(
      { ...pkg, dependencies: { a: "^2.0.0" } },
      lock(),
    );
    expect(result.problems).toEqual([
      'dependencies: "a" is "^2.0.0" in package.json but "^1.0.0" in package-lock.json.',
    ]);
  });

  it("flags a dependency removed from package.json but left in the lock", () => {
    const result = checkLockfileSync({ ...pkg, dependencies: {} }, lock());
    expect(result.problems).toEqual([
      'dependencies: "a" is in package-lock.json but no longer in package.json.',
    ]);
  });

  it("flags a root entry without an installed node_modules entry", () => {
    const l = lock();
    delete (l.packages as Record<string, unknown>)["node_modules/a"];
    expect(checkLockfileSync(pkg, l).problems).toEqual([
      expect.stringContaining('"a" has no "node_modules/a" entry'),
    ]);
  });

  it("accepts a workspace link entry", () => {
    const l = lock();
    (l.packages as Record<string, unknown>)["node_modules/a"] = {
      resolved: "packages/a",
      link: true,
    };
    expect(checkLockfileSync(pkg, l).ok).toBe(true);
  });

  it("does not require top-level entries for peerDependencies", () => {
    const l = lock();
    (l.packages[""] as Record<string, unknown>).peerDependencies = {
      react: ">=18",
    };
    expect(
      checkLockfileSync({ ...pkg, peerDependencies: { react: ">=18" } }, l).ok,
    ).toBe(true);
  });

  it("flags a name mismatch", () => {
    expect(checkLockfileSync({ ...pkg, name: "other" }, lock()).ok).toBe(false);
  });

  it.each([null, {}, { lockfileVersion: 1, dependencies: {} }])(
    "rejects a lockfile without a packages map (%p)",
    (bad) => {
      const result = checkLockfileSync(pkg, bad as never);
      expect(result.ok).toBe(false);
      expect(result.problems[0]).toMatch(/lockfileVersion 2\+/);
    },
  );

  it("rejects a lockfile without a root entry", () => {
    const result = checkLockfileSync(pkg, { packages: {} });
    expect(result.problems).toEqual([
      "package-lock.json is missing its root package entry.",
    ]);
  });
});

describe("formatLockfileReport", () => {
  it("summarises success", () => {
    expect(formatLockfileReport({ ok: true, problems: [] })).toMatch(/in sync/);
  });

  it("lists problems and the fix", () => {
    const report = formatLockfileReport({ ok: false, problems: ["x"] });
    expect(report).toContain("  - x");
    expect(report).toContain("npm install --package-lock-only");
  });
});

describe("this repository (#795)", () => {
  it("has a package-lock.json in sync with package.json", async () => {
    const [repoPkg, repoLock] = await Promise.all([
      fs.readJson(path.join(ROOT, "package.json")),
      fs.readJson(path.join(ROOT, "package-lock.json")),
    ]);
    const result = checkLockfileSync(repoPkg, repoLock);
    expect(result.problems).toEqual([]);
  });

  it("locks @types/pngjs at the declared range", async () => {
    const repoLock = await fs.readJson(path.join(ROOT, "package-lock.json"));
    expect(repoLock.packages[""].devDependencies["@types/pngjs"]).toBe(
      "^6.0.5",
    );
    expect(repoLock.packages["node_modules/@types/pngjs"].version).toMatch(
      /^6\./,
    );
  });
});
