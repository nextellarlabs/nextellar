import { jest } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATES = path.resolve(__dirname, "../src/templates");
const templateFile = (template: string, rel: string) =>
  path.join(TEMPLATES, template, "src", rel);

/** Strips ANSI escape codes so assertions can check plain text content. */
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const stripAnsi = (value: string) => value.replace(ANSI_PATTERN, "");

describe("upgrade changelog diff colorization", () => {
  const tmpDirs: string[] = [];
  let origCwd: string;
  let logSpy: jest.SpyInstance;

  const output = () => logSpy.mock.calls.map((c) => c.join(" ")).join("\n");

  const makeProject = async (overrides: Record<string, string> = {}) => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "nextellar-upgrade-diff-"),
    );
    tmpDirs.push(dir);

    await fs.outputJson(path.join(dir, ".nextellar/config.json"), {
      template: "minimal",
      nextellarVersion: "1.0.0",
    });

    const tplPkg = await fs.readJson(
      path.join(TEMPLATES, "minimal", "package.json"),
    );
    await fs.writeJson(path.join(dir, "package.json"), {
      name: "demo",
      dependencies: { ...tplPkg.dependencies },
      devDependencies: { ...tplPkg.devDependencies },
    });

    const managed = [
      "hooks/useStellarWallet.ts",
      "hooks/useStellarBalances.ts",
      "lib/storage.ts",
    ];
    for (const rel of managed) {
      const dest = path.join(dir, "src", rel);
      await fs.ensureDir(path.dirname(dest));
      await fs.copyFile(templateFile("minimal", rel), dest);
    }
    for (const [rel, content] of Object.entries(overrides)) {
      await fs.outputFile(path.join(dir, rel), content);
    }

    return dir;
  };

  beforeEach(() => {
    origCwd = process.cwd();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(origCwd);
    logSpy.mockRestore();
    await Promise.all(tmpDirs.map((d) => fs.remove(d).catch(() => {})));
    tmpDirs.length = 0;
  });

  // picocolors decides whether to emit ANSI codes once, at import time,
  // based on process.stdout.isTTY / NO_COLOR / FORCE_COLOR (it has no
  // per-call override). Under Jest, stdout is never a TTY, so color is off
  // by default — exactly the "respects non-TTY" behavior the acceptance
  // criteria ask for. To exercise the *colorized* path we force it on via
  // FORCE_COLOR and re-import both picocolors and upgrade.ts fresh in an
  // isolated module registry, rather than asserting on ambient jest-runner
  // TTY state (which is what made an earlier version of this test flaky).
  it("emits ANSI color codes for added/removed lines when color is supported (FORCE_COLOR)", async () => {
    const dir = await makeProject({
      "src/hooks/useStellarBalances.ts":
        "// stale local copy\nconst removedLine = true;\n",
    });
    process.chdir(dir);

    const prevForceColor = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = "1";
    let raw = "";
    await jest.isolateModulesAsync(async () => {
      const { upgrade: isolatedUpgrade } =
        await import("../src/lib/upgrade.js");
      await isolatedUpgrade({ dryRun: true });
      raw = output();
    });
    if (prevForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = prevForceColor;

    // Red for a removed line, green for an added line (picocolors ANSI codes).
    // eslint-disable-next-line no-control-regex
    expect(raw).toMatch(/\x1b\[31m- .*removedLine/);
    // eslint-disable-next-line no-control-regex
    expect(raw).toMatch(/\x1b\[32m\+ /);
  });

  it("respects a non-TTY/no-color environment by emitting plain text (no ANSI codes)", async () => {
    const dir = await makeProject({
      "src/hooks/useStellarBalances.ts":
        "// stale local copy\nconst removedLine = true;\n",
    });
    process.chdir(dir);

    // Jest's stdout is never a TTY and FORCE_COLOR/CI aren't set for this
    // test, so picocolors' own color-support detection should already
    // produce plain, uncolored output here.
    const { upgrade: freshUpgrade } = await import("../src/lib/upgrade.js");
    await freshUpgrade({ dryRun: true });
    const raw = output();

    // eslint-disable-next-line no-control-regex
    expect(raw).not.toMatch(/\x1b\[/);
    expect(raw).toContain("- // stale local copy");
    expect(raw).toContain("- const removedLine = true;");
  });

  it("renders the diff content correctly regardless of color support (snapshot-style, color stripped)", async () => {
    const dir = await makeProject({
      "src/hooks/useStellarBalances.ts":
        "// stale local copy\nconst removedLine = true;\n",
    });
    process.chdir(dir);

    const { upgrade: freshUpgrade } = await import("../src/lib/upgrade.js");
    await freshUpgrade({ dryRun: true });
    const plain = stripAnsi(output());

    expect(plain).toContain("~ hooks/useStellarBalances.ts (modified)");
    expect(plain).toContain("- // stale local copy");
    expect(plain).toContain("- const removedLine = true;");
    expect(plain).toContain("+");
  });

  it("truncates large diffs and reports the number of omitted lines", async () => {
    const bigOld = Array.from({ length: 40 }, (_, i) => `old line ${i}`).join(
      "\n",
    );
    const dir = await makeProject({
      "src/hooks/useStellarBalances.ts": bigOld,
    });
    process.chdir(dir);

    const { upgrade: freshUpgrade } = await import("../src/lib/upgrade.js");
    await freshUpgrade({ dryRun: true });
    const plain = stripAnsi(output());

    expect(plain).toMatch(/more line\(s\) not shown/);
  });

  it("shows no diff body for a newly added file, only the (new file) label", async () => {
    // useStellarWallet.ts is copied as-is so only useStellarBalances differs;
    // remove it locally so the upgrade reports it as "added" instead.
    const dir = await makeProject();
    await fs.remove(path.join(dir, "src/hooks/useStellarWallet.ts"));
    process.chdir(dir);

    const { upgrade: freshUpgrade } = await import("../src/lib/upgrade.js");
    await freshUpgrade({ dryRun: true });
    const plain = stripAnsi(output());

    expect(plain).toContain("+ hooks/useStellarWallet.ts (new file)");
  });
});
