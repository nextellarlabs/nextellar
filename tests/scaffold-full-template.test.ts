/**
 * `--template full` (#1112): the default component set, defi's Soroban
 * CounterDemo and the contracts overlay, in both TypeScript and JavaScript.
 */
import { jest } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";

const mockRunInstall = jest.fn();
jest.unstable_mockModule("../src/lib/install.js", () => ({
  detectPackageManager: () => "npm",
  runInstall: mockRunInstall,
}));

const mockExeca = jest.fn();
jest.unstable_mockModule("execa", () => ({ execa: mockExeca }));
jest.unstable_mockModule("../src/lib/preflight.js", () => ({
  runPreflight: async () => ({ ok: true, failures: [] }),
  setPreflightDisabledForTest: () => {},
  setNpmRunnerForTest: () => {},
  checkNodeVersion: () => ({ ok: true, detail: "test", fix: "" }),
  checkNpmAvailable: async () => ({ ok: true, detail: "test npm OK", fix: "" }),
}));

const { scaffold } = await import("../src/lib/scaffold");

jest.setTimeout(30000);

describe("scaffold --template full", () => {
  const originalCwd = process.cwd();
  let parent: string;
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    mockRunInstall.mockImplementation(async () => ({
      success: true,
      packageManager: "skipped",
    }));
    mockExeca.mockImplementation(async () => ({}));
    parent = await fs.mkdtemp(path.join(os.tmpdir(), "nextellar-full-"));
    process.chdir(parent);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    logSpy.mockRestore();
    jest.restoreAllMocks();
    await fs.remove(parent);
  });

  const exists = (dir: string, rel: string) =>
    fs.pathExists(path.join(dir, rel));

  test("TypeScript: default components + CounterDemo + contracts", async () => {
    await scaffold({
      appName: "full-ts",
      useTs: true,
      template: "full",
      skipInstall: true,
    });
    const dir = path.join(parent, "full-ts");

    // default's full component set (not present in defi)
    expect(await exists(dir, "src/components/AccountSwitcher.tsx")).toBe(true);
    expect(await exists(dir, "src/components/ContractCallForm.tsx")).toBe(true);
    expect(await exists(dir, "src/contexts/ThemeProvider.tsx")).toBe(true);

    // defi's Soroban demo, wired into the landing page and Storybook
    expect(await exists(dir, "src/components/CounterDemo.tsx")).toBe(true);
    expect(await exists(dir, "src/components/CounterDemo.stories.tsx")).toBe(
      true,
    );
    const page = await fs.readFile(path.join(dir, "src/app/page.tsx"), "utf8");
    expect(page).toContain("<CounterDemo />");
    const sbMain = await fs.readFile(
      path.join(dir, ".storybook/main.ts"),
      "utf8",
    );
    expect(sbMain).toContain('"@/lib/contracts"');
    expect(await exists(dir, ".storybook/mocks/contracts.ts")).toBe(true);

    // contracts overlay pre-enabled without passing withContracts
    expect(await exists(dir, "contracts")).toBe(true);
    expect(await exists(dir, "src/lib/contracts/index.ts")).toBe(true);
    const pkg = await fs.readJson(path.join(dir, "package.json"));
    expect(pkg.scripts["contracts:build"]).toBeDefined();
    expect(pkg.scripts["contracts:test"]).toBeDefined();
    const env = await fs.readFile(path.join(dir, ".env.example"), "utf8");
    expect(env).toContain("NEXT_PUBLIC_HELLO_WORLD_CONTRACT_ID");

    // project metadata records the composed template name
    const config = await fs.readJson(path.join(dir, ".nextellar/config.json"));
    expect(config.template).toBe("full");
  });

  test("JavaScript: js-template components + CounterDemo + contracts", async () => {
    await scaffold({
      appName: "full-js",
      useTs: false,
      template: "full",
      skipInstall: true,
    });
    const dir = path.join(parent, "full-js");

    expect(await exists(dir, "src/components/AccountSwitcher.jsx")).toBe(true);
    expect(await exists(dir, "src/components/CounterDemo.jsx")).toBe(true);
    expect(await exists(dir, "src/components/CounterDemo.tsx")).toBe(false);
    const page = await fs.readFile(path.join(dir, "src/app/page.jsx"), "utf8");
    expect(page).toContain("<CounterDemo />");
    expect(await exists(dir, "contracts")).toBe(true);
    expect(await exists(dir, "src/app/page.tsx")).toBe(false);
  });

  test("contracts stay on even when withContracts is explicitly false", async () => {
    await scaffold({
      appName: "full-no-flag",
      useTs: true,
      template: "full",
      withContracts: false,
      skipInstall: true,
    });
    expect(
      await exists(path.join(parent, "full-no-flag"), "SOROBAN_SETUP.md"),
    ).toBe(true);
  });

  test("does not change the default template", async () => {
    await scaffold({
      appName: "plain-default",
      useTs: true,
      template: "default",
      skipInstall: true,
    });
    const dir = path.join(parent, "plain-default");
    expect(await exists(dir, "src/components/CounterDemo.tsx")).toBe(false);
    expect(await exists(dir, "contracts")).toBe(false);
  });

  test("dry run lists the overlay and contracts files without writing", async () => {
    await scaffold({
      appName: "full-dry",
      useTs: true,
      template: "full",
      skipInstall: true,
      dryRun: true,
    });
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain("(full overlay)");
    expect(out).toContain("src/components/CounterDemo.tsx");
    expect(out).toContain("(contracts overlay)");
    expect(out).toMatch(/Contracts:.*Yes/);
    expect(await fs.pathExists(path.join(parent, "full-dry"))).toBe(false);
  });

  test("fails and cleans up when the overlay directory is missing", async () => {
    const realPathExists = fs.pathExists.bind(fs);
    jest
      .spyOn(fs, "pathExists")
      .mockImplementation((async (p: string) =>
        path.basename(p) === "full" &&
        path.basename(path.dirname(p)) === "templates"
          ? false
          : realPathExists(p)) as never);

    await expect(
      scaffold({
        appName: "full-broken",
        useTs: true,
        template: "full",
        skipInstall: true,
      }),
    ).rejects.toThrow(/Template overlay "full" for "full" is missing/);
    expect(await realPathExists(path.join(parent, "full-broken"))).toBe(false);
  });
});
