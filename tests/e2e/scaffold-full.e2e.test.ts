import { jest } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { scaffold } from "../../src/lib/scaffold.js";

const execFileAsync = promisify(execFile);

jest.setTimeout(20 * 60 * 1000);

const RUN_E2E =
  process.env.NEXTELLAR_E2E === "1" || process.env.RUN_E2E === "1";
const describeE2E = RUN_E2E ? describe : describe.skip;

/**
 * These tests scaffold a real app and run `next build` against it, so they
 * hit npm and the network. Gated behind NEXTELLAR_E2E=1 (or RUN_E2E=1) to
 * keep `npm test` fast.
 *
 * The `full` template (#1112) is the most complex starter: it composes the
 * `default` base with the `defi` overlay's Soroban demo and always pulls in
 * the contracts overlay, so this covers the combination the other scaffold
 * e2e tests exercise individually (see scaffold-default/js-defi/with-contracts).
 */
describeE2E("e2e: full template scaffold", () => {
  const tmpDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => fs.remove(d).catch(() => {})));
  });

  it("scaffolds the full template with the contracts overlay and builds successfully", async () => {
    const parentDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "nextellar-e2e-full-"),
    );
    tmpDirs.push(parentDir);
    const appName = "full-app";
    const appDir = path.join(parentDir, appName);

    const origCwd = process.cwd();
    process.chdir(parentDir);
    try {
      await scaffold({
        appName,
        useTs: true,
        template: "full",
        skipInstall: true,
        telemetryEnabled: false,
      });
    } finally {
      process.chdir(origCwd);
    }

    // `full` always forces the contracts overlay on, even without
    // --with-contracts (templateForcesContracts in src/lib/templates.ts).
    expect(await fs.pathExists(path.join(appDir, "src/lib/contracts"))).toBe(
      true,
    );
    expect(await fs.pathExists(path.join(appDir, "contracts"))).toBe(true);

    // Placeholders resolved
    const pkgJson = await fs.readJson(path.join(appDir, "package.json"));
    expect(pkgJson.name).toBe(appName);
    expect(pkgJson.scripts).toMatchObject({
      "contracts:build": "cd contracts && stellar contract build",
      "contracts:test": "cd contracts && cargo test",
    });

    const readme = await fs.readFile(path.join(appDir, "README.md"), "utf8");
    expect(readme).not.toContain("{{APP_NAME}}");

    const envExample = await fs.readFile(
      path.join(appDir, ".env.example"),
      "utf8",
    );
    expect(envExample).not.toMatch(/\{\{.*\}\}/);

    // No stray .js/.jsx source files in a TypeScript scaffold
    const strayJsFiles: string[] = [];
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name === "node_modules" ||
          entry.name === ".next" ||
          entry.name === "contracts"
        ) {
          continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (
          /\.(js|jsx)$/.test(entry.name) &&
          !entry.name.endsWith(".config.js")
        ) {
          strayJsFiles.push(full);
        }
      }
    };
    await walk(path.join(appDir, "src"));
    expect(strayJsFiles).toEqual([]);

    // Install and build for real
    await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: appDir,
      shell: true,
    });
    await execFileAsync("npm", ["run", "build"], { cwd: appDir, shell: true });
  });
});
