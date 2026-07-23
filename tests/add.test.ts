import { jest } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

jest.unstable_mockModule("execa", () => ({
  execa: jest.fn(),
}));

const execaModule = await import("execa");
const featuresModule = await import("../src/lib/features.js");
const { runAdd } = await import("../src/lib/add.js");

const mockedExeca = jest.mocked(execaModule.execa);

function mockInstallerSuccess() {
  mockedExeca.mockResolvedValue({ exitCode: 0 } as any);
}

beforeEach(() => {
  mockedExeca.mockReset();
  mockInstallerSuccess();
});

describe("runAdd", () => {
  let tmpDir: string;
  const templateDir = path.resolve(
    __dirname,
    "../src/templates/default"
  );

  async function setupProject(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "add-test-"));
    const pkg = {
      name: "test-project",
      version: "1.0.0",
      dependencies: {},
      devDependencies: {},
    };
    await fs.writeJson(path.join(dir, "package.json"), pkg);
    return dir;
  }

  async function cleanup(...dirs: string[]) {
    await Promise.all(
      dirs.map((d) => fs.remove(d).catch(() => {}))
    );
  }

  it("returns { success: false } with helpful message for unknown feature id", async () => {
    tmpDir = await setupProject();
    try {
      const result = await runAdd("nonexistent-feature-xyz", { cwd: tmpDir });
      expect(result.success).toBe(false);
      expect(result.message).toContain("Unknown feature");
      expect(result.message).toContain("nonexistent-feature-xyz");
    } finally {
      await cleanup(tmpDir);
    }
  });

  it("copies feature files from the default template into the project (happy path)", async () => {
    tmpDir = await setupProject();
    try {
      const result = await runAdd("history", { cwd: tmpDir, skipInstall: true });
      expect(result.success).toBe(true);
      const destFile = path.join(tmpDir, "src/hooks/useTransactionHistory.ts");
      expect(await fs.pathExists(destFile)).toBe(true);
    } finally {
      await cleanup(tmpDir);
    }
  });

  it("skips existing destination files without --force and overwrites them with --force", async () => {
    tmpDir = await setupProject();
    try {
      const targetDir = path.join(tmpDir, "src/hooks");
      await fs.ensureDir(targetDir);
      const existingContent = "// existing content";
      const destFile = path.join(targetDir, "useTransactionHistory.ts");
      await fs.writeFile(destFile, existingContent);

      const resultSkip = await runAdd("history", {
        cwd: tmpDir,
        skipInstall: true,
        force: false,
      });
      expect(resultSkip.success).toBe(false);
      expect(resultSkip.message).toContain("--force");
      expect(await fs.readFile(destFile, "utf8")).toBe(existingContent);

      const resultForce = await runAdd("history", {
        cwd: tmpDir,
        skipInstall: true,
        force: true,
      });
      expect(resultForce.success).toBe(true);
      const templateSrc = path.join(templateDir, "src/hooks/useTransactionHistory.ts");
      const templateContent = await fs.readFile(templateSrc, "utf8");
      expect(await fs.readFile(destFile, "utf8")).toBe(templateContent);
    } finally {
      await cleanup(tmpDir);
    }
  });

  it("never invokes the package manager when skipInstall is true", async () => {
    tmpDir = await setupProject();
    try {
      const result = await runAdd("wallet", {
        cwd: tmpDir,
        skipInstall: true,
      });
      expect(result.success).toBe(true);
      expect(mockedExeca).not.toHaveBeenCalled();
    } finally {
      await cleanup(tmpDir);
    }
  });

  it("passes npm dependencies matching the feature registry entry to the installer", async () => {
    tmpDir = await setupProject();
    try {
      const feature = featuresModule.getFeature("wallet");
      const expectedDeps = feature!.npmDependencies;

      const result = await runAdd("wallet", { cwd: tmpDir, skipInstall: false });
      expect(result.success).toBe(true);

      const calls = mockedExeca.mock.calls.map(
        ([cmd, args]: any) => ({ cmd, args })
      );

      const installCall = calls.find(
        (c: any) => c.cmd === "npm" || c.cmd === "yarn" || c.cmd === "pnpm"
      );
      expect(installCall).toBeDefined();

      for (const dep of expectedDeps) {
        expect(installCall!.args).toContain(dep);
      }
    } finally {
      await cleanup(tmpDir);
    }
  });
});