import { execa } from "execa";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const cli = path.resolve(__dirname, "../dist/bin/nextellar.js");
// The project name doubles as the target directory and must not contain path
// separators, so scaffold by bare name from inside tests/.
const appName = "tmp-test-app";
const tmpDir = path.join(__dirname, appName);

describe("nextellar CLI", () => {
  beforeEach(async () => {
    await fs.remove(tmpDir);
  }, 10000);

  // The scaffolded app ships its own __tests__, so don't leave it inside
  // tests/ for a later Jest run to pick up.
  afterAll(async () => {
    await fs.remove(tmpDir);
  }, 10000);

  it("should scaffold a new project and exit cleanly", async () => {
    const { exitCode, stdout } = await execa(
      "node",
      [cli, appName, "--typescript", "--defaults", "--skip-install"],
      { cwd: __dirname },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("✔ Nextellar scaffold complete!");
    expect(await fs.pathExists(tmpDir)).toBe(true);
  }, 30000);

  describe("--yes / --defaults non-interactive flag (#948)", () => {
    it("--yes scaffolds without prompting, same as --defaults", async () => {
      const { exitCode, stdout } = await execa(
        "node",
        [cli, appName, "--typescript", "--yes", "--skip-install"],
        { cwd: __dirname },
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain("✔ Nextellar scaffold complete!");
      expect(await fs.pathExists(tmpDir)).toBe(true);
    }, 30000);

    it("-y short flag works the same as --yes", async () => {
      const { exitCode, stdout } = await execa(
        "node",
        [cli, appName, "--typescript", "-y", "--skip-install"],
        { cwd: __dirname },
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain("✔ Nextellar scaffold complete!");
      expect(await fs.pathExists(tmpDir)).toBe(true);
    }, 30000);

    it("errors clearly when the required project-name argument is missing, even with --defaults", async () => {
      const { exitCode, stderr } = await execa("node", [cli, "--defaults"], {
        reject: false,
      });
      expect(exitCode).toBe(1);
      expect(stderr).toContain("missing required argument 'project-name'");
    }, 15000);

    it("errors clearly when the required project-name argument is missing, even with --yes", async () => {
      const { exitCode, stderr } = await execa("node", [cli, "--yes"], {
        reject: false,
      });
      expect(exitCode).toBe(1);
      expect(stderr).toContain("missing required argument 'project-name'");
    }, 15000);
  });

  it("should scaffold --javascript --template minimal without failing fast", async () => {
    const { exitCode, stdout } = await execa(
      "node",
      [
        cli,
        appName,
        "--javascript",
        "--template",
        "minimal",
        "--defaults",
        "--skip-install",
      ],
      { cwd: __dirname, reject: false },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Nextellar scaffold complete");
    expect(await fs.pathExists(tmpDir)).toBe(true);
    // JS variant ships jsconfig.json, not tsconfig.json
    expect(await fs.pathExists(path.join(tmpDir, "jsconfig.json"))).toBe(true);
    expect(await fs.pathExists(path.join(tmpDir, "tsconfig.json"))).toBe(false);
  }, 30000);

  it("should scaffold --javascript --template defi without failing fast", async () => {
    const { exitCode, stdout } = await execa(
      "node",
      [
        cli,
        appName,
        "--javascript",
        "--template",
        "defi",
        "--defaults",
        "--skip-install",
      ],
      { cwd: __dirname, reject: false },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Nextellar scaffold complete");
    expect(await fs.pathExists(tmpDir)).toBe(true);
    expect(await fs.pathExists(path.join(tmpDir, "jsconfig.json"))).toBe(true);
    expect(await fs.pathExists(path.join(tmpDir, "tsconfig.json"))).toBe(false);
  }, 30000);

  describe("clean (#904)", () => {
    it("removes .nextellar/build and exits cleanly", async () => {
      const buildDir = path.join(tmpDir, ".nextellar", "build");
      await fs.outputFile(
        path.join(buildDir, "artifact.txt"),
        "stale build output",
      );

      const { exitCode, stdout } = await execa("node", [cli, "clean"], {
        cwd: tmpDir,
      });

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Removed .nextellar/build");
      expect(await fs.pathExists(buildDir)).toBe(false);
    }, 15000);

    it("exits cleanly (no error) when .nextellar/build does not exist", async () => {
      await fs.ensureDir(tmpDir);

      const { exitCode, stdout } = await execa("node", [cli, "clean"], {
        cwd: tmpDir,
      });

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Nothing to clean");
    }, 15000);
  });

  it("prints a pre-scaffold summary of resolved options before writing files with --defaults", async () => {
    const { exitCode, stdout } = await execa(
      "node",
      [
        cli,
        appName,
        "--typescript",
        "--defaults",
        "--skip-install",
        "--with-contracts",
        "--no-telemetry",
      ],
      { cwd: __dirname },
    );

    expect(exitCode).toBe(0);

    const summaryIndex = stdout.indexOf(
      "Scaffolding with the following options:",
    );
    const completeIndex = stdout.indexOf("✔ Nextellar scaffold complete!");
    // Summary must print, and must print before scaffolding actually
    // completes (issue #1082: before any files are written).
    expect(summaryIndex).toBeGreaterThan(-1);
    expect(completeIndex).toBeGreaterThan(-1);
    expect(summaryIndex).toBeLessThan(completeIndex);

    expect(stdout).toContain(appName);
    expect(stdout).toContain("TypeScript");
    expect(stdout).toContain("default");
    // --with-contracts was passed: the summary must reflect it, not just a
    // static template.
    expect(stdout).toMatch(/Contracts:\s+Yes/);
  }, 30000);
});
