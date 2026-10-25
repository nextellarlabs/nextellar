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
 * Same gap as scaffold-full.e2e.test.ts, for the JavaScript `js-full`
 * variant of the composed `full` starter (#1112).
 */
describeE2E("e2e: js-full template scaffold", () => {
  const tmpDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => fs.remove(d).catch(() => {})));
  });

  it("scaffolds the js-full template with the contracts overlay and builds successfully", async () => {
    const parentDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "nextellar-e2e-js-full-"),
    );
    tmpDirs.push(parentDir);
    const appName = "js-full-app";
    const appDir = path.join(parentDir, appName);

    const origCwd = process.cwd();
    process.chdir(parentDir);
    try {
      await scaffold({
        appName,
        useTs: false,
        template: "full",
        skipInstall: true,
        telemetryEnabled: false,
      });
    } finally {
      process.chdir(origCwd);
    }

    // JavaScript project: jsconfig.json present. Note that unlike the plain
    // js-template/js-defi scaffolds, `js-full` legitimately ships a handful
    // of .ts/.tsx files (Storybook mocks, test files, and the contracts
    // overlay's generated Soroban bindings under src/lib/bindings), so this
    // test doesn't assert zero .ts/.tsx files the way scaffold-js-template
    // and scaffold-js-defi do for their plain JS scaffolds.
    expect(await fs.pathExists(path.join(appDir, "jsconfig.json"))).toBe(true);

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

    // Install and build for real
    await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: appDir,
      shell: true,
    });
    await execFileAsync("npm", ["run", "build"], { cwd: appDir, shell: true });
  });
});
