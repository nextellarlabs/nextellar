/**
 * `nextellar upgrade --diff` (#1116)
 *
 * Runs against tests/__fixtures__/upgrade-drift-project, a project with known
 * drift from the `default` template:
 *   - src/hooks/useStellarWallet.ts is locally customised (updated)
 *   - src/hooks/useTrustlines.ts is missing (added by the template)
 *   - package.json pins an older @stellar/stellar-sdk
 * Every other hooks/lib file is copied verbatim from the template so it
 * counts as unchanged.
 */
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";
import { jest } from "@jest/globals";
import { upgrade, renderFullFileDiff } from "../src/lib/upgrade";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE = path.join(__dirname, "__fixtures__", "upgrade-drift-project");
const TEMPLATE_SRC = path.resolve(__dirname, "../src/templates/default/src");
const DRIFTED = path.join("hooks", "useStellarWallet.ts");
const MISSING = path.join("hooks", "useTrustlines.ts");
const UNCHANGED = path.join("hooks", "useStellarBalances.ts");

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const stripAnsi = (value: string) => value.replace(ANSI_PATTERN, "");

async function snapshotTree(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string): Promise<void> {
    const children = await fs.readdir(dir, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const abs = path.join(dir, child.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (child.isDirectory()) {
        out.push(`${rel}/`);
        await visit(abs);
      } else {
        const hash = createHash("sha256")
          .update(await fs.readFile(abs))
          .digest("hex");
        out.push(`${rel}:${hash}`);
      }
    }
  }
  await visit(root);
  return out;
}

describe("upgrade --diff", () => {
  const originalCwd = process.cwd();
  let projectDir: string;
  let logSpy: jest.SpyInstance;

  const output = () =>
    stripAnsi(logSpy.mock.calls.map((c) => c.join(" ")).join("\n"));

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "nextellar-upgrade-diff-mode-"),
    );
    await fs.copy(FIXTURE, projectDir);

    // Make every other hooks/lib file identical to the template so the only
    // drift is the one the fixture declares.
    for (const sub of ["hooks", "lib"]) {
      for (const name of await fs.readdir(path.join(TEMPLATE_SRC, sub))) {
        const rel = path.join(sub, name);
        if (rel === DRIFTED || rel === MISSING) continue;
        const from = path.join(TEMPLATE_SRC, rel);
        if (!(await fs.stat(from)).isFile()) continue;
        await fs.copy(from, path.join(projectDir, "src", rel));
      }
    }

    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    process.chdir(projectDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    logSpy.mockRestore();
    await fs.remove(projectDir);
  });

  test("prints a file-by-file diff for the drifted file", async () => {
    await upgrade({ diff: true });
    const out = output();

    expect(out).toContain("--- a/src/hooks/useStellarWallet.ts (project)");
    expect(out).toContain("+++ b/src/hooks/useStellarWallet.ts (template)");
    expect(out).toContain("- // nextellar-fixture: local drift");
  });

  test("shows template-only files as new against /dev/null", async () => {
    await upgrade({ diff: true });
    const out = output();

    const devNull = out.indexOf("--- /dev/null");
    expect(devNull).toBeGreaterThan(-1);
    expect(out.slice(devNull)).toContain(
      "+++ b/src/hooks/useTrustlines.ts (template)",
    );
  });

  test("does not list unchanged files and reports counts", async () => {
    await upgrade({ diff: true });
    const out = output();

    expect(out).not.toContain(UNCHANGED.split(path.sep).join("/"));
    expect(out).toMatch(/2 file\(s\) differ/);
    expect(out).toContain("--diff specified; no files were modified.");
  });

  test("includes stellar package version drift from package.json", async () => {
    await upgrade({ diff: true });
    const out = output();

    expect(out).toContain("--- a/package.json (project)");
    expect(out).toContain('- "@stellar/stellar-sdk": "^11.0.0"');
    expect(out).toMatch(/\+ "@stellar\/stellar-sdk": "[^"]+"/);
  });

  test("is not truncated like the --check changelog", async () => {
    await upgrade({ diff: true });
    expect(output()).not.toContain("more line(s) not shown");
  });

  test("never modifies the project, even with --yes", async () => {
    const before = await snapshotTree(projectDir);

    await upgrade({ diff: true, yes: true });

    expect(await snapshotTree(projectDir)).toEqual(before);
    expect(
      await fs.pathExists(path.join(projectDir, ".nextellar", "backups")),
    ).toBe(false);
    const config = await fs.readJson(
      path.join(projectDir, ".nextellar", "config.json"),
    );
    expect(config.nextellarVersion).toBe("1.0.0");
  });

  test("reports nothing to diff when the project matches the template", async () => {
    await fs.copy(
      path.join(TEMPLATE_SRC, DRIFTED),
      path.join(projectDir, "src", DRIFTED),
    );
    await fs.copy(
      path.join(TEMPLATE_SRC, MISSING),
      path.join(projectDir, "src", MISSING),
    );
    const tplPkg = await fs.readJson(
      path.resolve(TEMPLATE_SRC, "..", "package.json"),
    );
    await fs.writeJson(path.join(projectDir, "package.json"), {
      name: "upgrade-drift-fixture",
      dependencies: tplPkg.dependencies,
      devDependencies: tplPkg.devDependencies,
    });

    await upgrade({ diff: true });

    expect(output()).toContain("No template updates to apply.");
    expect(output()).not.toContain("+++ b/");
  });

  test("resolves a composed template (full) to its base starter", async () => {
    await fs.writeJson(path.join(projectDir, ".nextellar", "config.json"), {
      nextellarVersion: "1.0.0",
      template: "full",
    });

    await upgrade({ diff: true });

    expect(output()).toContain(
      "--- a/src/hooks/useStellarWallet.ts (project)",
    );
  });

  test("fails outside a Nextellar project", async () => {
    await fs.remove(path.join(projectDir, ".nextellar"));
    await expect(upgrade({ diff: true })).rejects.toThrow(
      /Not a Nextellar project/,
    );
  });

  test("fails for an unknown template", async () => {
    await fs.writeJson(path.join(projectDir, ".nextellar", "config.json"), {
      nextellarVersion: "1.0.0",
      template: "does-not-exist",
    });
    await expect(upgrade({ diff: true })).rejects.toThrow(
      /Could not locate template/,
    );
  });
});

describe("renderFullFileDiff", () => {
  test("emits git-style headers and +/- lines", () => {
    const lines = renderFullFileDiff(
      path.join("hooks", "x.ts"),
      "a\nb",
      "a\nc",
    ).map(stripAnsi);
    expect(lines[0]).toBe("--- a/src/hooks/x.ts (project)");
    expect(lines[1]).toBe("+++ b/src/hooks/x.ts (template)");
    expect(lines).toContain("- b");
    expect(lines).toContain("+ c");
    expect(lines).toContain("  a");
  });

  test("diffs a new file against /dev/null", () => {
    const lines = renderFullFileDiff("lib/y.ts", null, "one\ntwo").map(
      stripAnsi,
    );
    expect(lines).toEqual([
      "--- /dev/null",
      "+++ b/src/lib/y.ts (template)",
      "+ one",
      "+ two",
    ]);
  });

  test("does not truncate long diffs", () => {
    const big = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const lines = renderFullFileDiff("hooks/z.ts", "", big).map(stripAnsi);
    expect(lines.length).toBeGreaterThan(100);
    expect(lines.join("\n")).not.toContain("not shown");
  });
});
