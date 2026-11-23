/**
 * @jest-environment node
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The gate is a plain ESM script run by CI with `node`; exercise it the same
// way (as a child process) so the test covers the real entry point.
const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, "../../scripts/check-changelog.mjs");

function run(changedFiles: string[], labels?: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CHANGED_FILES: changedFiles.join("\n"),
  };
  if (labels !== undefined) env.PR_LABELS = JSON.stringify(labels);
  else delete env.PR_LABELS;
  const result = spawnSync(process.execPath, [SCRIPT], {
    env,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("scripts/check-changelog.mjs", () => {
  it("passes when no template files changed", () => {
    const result = run(["src/lib/add.ts", "README.md"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/No template files changed/);
  });

  it("passes for an empty change list", () => {
    expect(run([]).status).toBe(0);
  });

  it("fails when a template file changes without a changelog entry", () => {
    const result = run(["src/templates/default/src/lib/sep7.ts"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/CHANGELOG\.md was not updated/);
    expect(result.stderr).toContain("src/templates/default/src/lib/sep7.ts");
  });

  it("passes when the template change comes with a CHANGELOG.md change", () => {
    const result = run([
      "src/templates/default/src/lib/sep7.ts",
      "CHANGELOG.md",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/CHANGELOG\.md was updated/);
  });

  it("passes with the skip-changelog opt-out label", () => {
    const result = run(
      ["src/templates/minimal/package.json"],
      ["bug", "skip-changelog"],
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/skip-changelog/);
  });

  it("still fails when other, unrelated labels are present", () => {
    expect(
      run(
        ["src/templates/minimal/package.json"],
        ["enhancement", "area:templates"],
      ).status,
    ).toBe(1);
  });

  it("does not treat a lookalike label as the opt-out", () => {
    expect(
      run(
        ["src/templates/minimal/package.json"],
        ["skip-changelog-please", "Skip-Changelog"],
      ).status,
    ).toBe(1);
  });

  it("ignores malformed label JSON instead of crashing or opting out", () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      env: {
        ...process.env,
        CHANGED_FILES: "src/templates/minimal/package.json",
        PR_LABELS: "not json",
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
  });

  it("does not count a changelog-named file elsewhere in the tree", () => {
    expect(run(["src/templates/default/CHANGELOG.md"]).status).toBe(1);
    expect(
      run(["docs/CHANGELOG.md", "src/templates/default/package.json"]).status,
    ).toBe(1);
  });

  it("does not match paths that merely start like the templates directory", () => {
    expect(
      run(["src/templates-docs/readme.md", "src/templatesX/file.ts"]).status,
    ).toBe(0);
  });

  it("handles Windows-style separators and a ./ prefix", () => {
    expect(run(["src\\templates\\default\\package.json"]).status).toBe(1);
    expect(
      run(["./src/templates/default/package.json", "./CHANGELOG.md"]).status,
    ).toBe(0);
  });

  it("lists the offending files and truncates a very long list", () => {
    const many = Array.from(
      { length: 25 },
      (_, i) => `src/templates/default/file-${i}.ts`,
    );

    const result = run(many);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("file-0.ts");
    expect(result.stderr).toMatch(/and 5 more/);
  });
});
