/**
 * stellar.toml template (#1462).
 *
 * Covers the three acceptance criteria from the issue:
 * - every app template ships public/.well-known/stellar.toml with the
 *   ACCOUNTS / [[CURRENCIES]] placeholders, and scaffolding keeps it;
 * - the template next.config serves it with Access-Control-Allow-Origin: *
 *   and Content-Type: text/plain (merged with the global security headers);
 * - doctor validates the placeholders: it warns while any are unfilled,
 *   passes when they are filled in, and passes as not-applicable when the
 *   file is absent.
 *
 * Placeholder style: the template uses REPLACE_WITH_... sentinels rather
 * than the scaffold's {{TOKEN}} syntax, because the placeholder-hygiene
 * test (#680) fails any scaffolded output that still contains a {{TOKEN}}
 * and scaffold has no issuer/asset values to substitute. The sentinels
 * follow the contracts overlay's C_REPLACE_WITH_YOUR_CONTRACT_ID precedent.
 */
import { jest } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  runDoctor,
  setCommandRunnerForTest,
  setFreeMemoryProviderForTest,
  type CommandRunner,
} from "../src/lib/doctor.js";
import * as defaultConfig from "../src/templates/default/next.config.js";
import * as minimalConfig from "../src/templates/minimal/next.config.js";
import * as defiConfig from "../src/templates/defi/next.config.js";

// Genuine ESM module (this file uses import.meta.url below), so mocking
// needs jest.unstable_mockModule rather than the classic jest.mock — the
// latter relies on babel's hoist-to-require transform, which doesn't apply
// once Jest is actually running the file as ESM (--experimental-vm-modules).
// Copied from tests/scaffold.test.ts: scaffold() runs a preflight gate, an
// install step, and `git init`, all of which must be stubbed out here.
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, "../src/templates");

jest.setTimeout(30000);

/** Scaffold app templates that must ship the stellar.toml template. */
const APP_TEMPLATES = [
  "default",
  "minimal",
  "defi",
  "js-template",
  "js-minimal",
  "js-defi",
];

const STELLAR_TOML_REL = path.join("public", ".well-known", "stellar.toml");

/** A filled-in stellar.toml: no placeholder sentinels left. */
const FILLED_TOML = [
  `ACCOUNTS=["${"G" + "A".repeat(55)}"],`,
  "",
  "[[CURRENCIES]]",
  `code="USD"`,
  `issuer="${"G" + "A".repeat(55)}"`,
  "",
].join("\n");

type HeaderRule = {
  source: string;
  headers: Array<{ key: string; value: string }>;
};

type NextConfigLike = {
  headers: () => Promise<HeaderRule[]>;
};

function sourceMatches(source: string, pathname: string): boolean {
  if (source === pathname) return true;
  if (source.endsWith("/:path*")) {
    return pathname.startsWith(source.slice(0, -"/:path*".length));
  }
  return false;
}

/**
 * Next.js applies every headers() rule whose source matches the path, in
 * order; a later rule wins on a repeated key. Reproduce that merge so the
 * test asserts the ACTUAL effective headers for the path, not just that a
 * rule entry exists.
 */
function effectiveHeaders(
  rules: HeaderRule[],
  pathname: string,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const rule of rules) {
    if (!sourceMatches(rule.source, pathname)) continue;
    for (const header of rule.headers) {
      merged[header.key] = header.value;
    }
  }
  return merged;
}

describe("stellar.toml template (#1462)", () => {
  let origCwd: string | undefined;
  const tmpParents: string[] = [];

  const makeTempParent = async (prefix = "nextellar-stellar-toml-") => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    tmpParents.push(dir);
    return dir;
  };

  beforeEach(() => {
    mockRunInstall.mockImplementation(async (options) =>
      options.skipInstall
        ? { success: true, packageManager: "skipped" }
        : { success: true, packageManager: "npm" },
    );
    mockExeca.mockReset();
    mockExeca.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (origCwd) process.chdir(origCwd);
    await Promise.all(
      tmpParents.map(async (p) => {
        try {
          await fs.remove(p);
        } catch {
          // ignore
        }
      }),
    );
    tmpParents.length = 0;
  });

  test.each(APP_TEMPLATES)(
    "%s ships public/.well-known/stellar.toml with the placeholders",
    async (name) => {
      const tomlPath = path.join(TEMPLATES_DIR, name, STELLAR_TOML_REL);
      expect(await fs.pathExists(tomlPath)).toBe(true);

      const contents = await fs.readFile(tomlPath, "utf8");
      expect(contents).toContain("ACCOUNTS=");
      expect(contents).toContain("[[CURRENCIES]]");
      expect(contents).toContain("G_REPLACE_WITH_YOUR_ISSUER_ACCOUNT");
      expect(contents).toContain("REPLACE_WITH_ASSET_CODE");
      // No {{TOKEN}} placeholders: the #680 hygiene test fails any
      // scaffolded output that still contains one.
      expect(contents).not.toMatch(/\{\{[A-Z_]+\}\}/);
    },
  );

  test("scaffolding keeps the stellar.toml template (TypeScript)", async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    await scaffold({
      appName: "stellar-toml-app-ts",
      useTs: true,
      template: "default",
      skipInstall: true,
    });

    const tomlPath = path.join(parent, "stellar-toml-app-ts", STELLAR_TOML_REL);
    expect(await fs.pathExists(tomlPath)).toBe(true);
    const contents = await fs.readFile(tomlPath, "utf8");
    expect(contents).toContain("ACCOUNTS=");
    expect(contents).toContain("[[CURRENCIES]]");
    expect(contents).toContain("G_REPLACE_WITH_YOUR_ISSUER_ACCOUNT");
  });

  test("scaffolding keeps the stellar.toml template (JavaScript)", async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    await scaffold({
      appName: "stellar-toml-app-js",
      useTs: false,
      template: "default",
      skipInstall: true,
    });

    const tomlPath = path.join(parent, "stellar-toml-app-js", STELLAR_TOML_REL);
    expect(await fs.pathExists(tomlPath)).toBe(true);
    const contents = await fs.readFile(tomlPath, "utf8");
    expect(contents).toContain("ACCOUNTS=");
    expect(contents).toContain("[[CURRENCIES]]");
    expect(contents).toContain("G_REPLACE_WITH_YOUR_ISSUER_ACCOUNT");
  });

  describe("next.config headers()", () => {
    test.each([
      ["default", defaultConfig],
      ["minimal", minimalConfig],
      ["defi", defiConfig],
    ])("%s serves stellar.toml with CORS + text/plain", async (_name, mod) => {
      const config = (mod as unknown as { default: NextConfigLike }).default;
      const rules = await config.headers();
      const headers = effectiveHeaders(rules, "/.well-known/stellar.toml");

      expect(headers["Access-Control-Allow-Origin"]).toBe("*");
      expect(headers["Content-Type"]).toBe("text/plain");
      // The stellar.toml rule adds to the global rule instead of
      // replacing it: the security headers still apply to this path.
      expect(headers["Content-Security-Policy"]).toContain(
        "default-src 'self'",
      );
      expect(headers["X-Frame-Options"]).toBe("DENY");
      // And the global rule sets neither key, so there is no conflict
      // for the merge to resolve.
      const global = rules.find((r) => r.source === "/:path*");
      expect(global?.headers.map((h) => h.key)).not.toContain("Content-Type");
      expect(global?.headers.map((h) => h.key)).not.toContain(
        "Access-Control-Allow-Origin",
      );
    });

    test.each(["js-template", "js-minimal", "js-defi"])(
      "%s next.config.js declares the stellar.toml rule after the global rule",
      async (name) => {
        // Asserted by text, not by import: the js templates' package.json
        // has no "type": "module", so Jest classifies their .js files as
        // CJS and importing one throws (see jest.config.mjs).
        const contents = await fs.readFile(
          path.join(TEMPLATES_DIR, name, "next.config.js"),
          "utf8",
        );
        const globalAt = contents.indexOf('source: "/:path*"');
        const stellarAt = contents.indexOf(
          'source: "/.well-known/stellar.toml"',
        );
        expect(globalAt).toBeGreaterThan(-1);
        expect(stellarAt).toBeGreaterThan(globalAt);
        expect(contents).toContain('"Access-Control-Allow-Origin"');
        expect(contents).toContain('"Content-Type"');
        expect(contents).toContain('"text/plain"');
      },
    );
  });

  describe("doctor validates stellar.toml placeholders", () => {
    const originalFetch = global.fetch;
    const originalLog = console.log;
    const tmpDirs: string[] = [];

    // Every check runDoctor() runs, keyed by the exact command string each
    // check invokes (see src/lib/doctor.ts). Defaults simulate a fully
    // healthy toolchain. Copied from tests/doctor.test.ts.
    const HEALTHY: Record<string, { ok: boolean; out: string }> = {
      "node --version": { ok: true, out: "v20.10.0" },
      "npm --version": { ok: true, out: "10.2.3" },
      "yarn --version": { ok: true, out: "1.22.19" },
      "pnpm --version": { ok: true, out: "8.10.0" },
      "git --version": { ok: true, out: "git version 2.42.0" },
      "rustc --version": { ok: true, out: "rustc 1.73.0" },
      "stellar --version": { ok: true, out: "stellar-cli 20.0.0" },
      "rustup target list --installed": {
        ok: true,
        out: "wasm32-unknown-unknown\nx86_64-apple-darwin",
      },
    };

    function withRunner(
      overrides: Record<string, { ok: boolean; out: string }> = {},
    ): CommandRunner {
      const table = { ...HEALTHY, ...overrides };
      return async (cmd: string) =>
        table[cmd] ?? { ok: false, out: "command not found" };
    }

    const projectWithStellarToml = async (contents: string | null) => {
      const dir = await fs.mkdtemp(
        path.join(os.tmpdir(), "nextellar-doctor-stellar-"),
      );
      tmpDirs.push(dir);
      if (contents !== null) {
        await fs.outputFile(path.join(dir, STELLAR_TOML_REL), contents);
      }
      process.chdir(dir);
    };

    const runDoctorJson = async () => {
      setCommandRunnerForTest(withRunner());
      let captured = "";
      console.log = jest.fn((line: string) => {
        captured += line;
      });
      const code = await runDoctor({ json: true });
      const parsed = JSON.parse(captured);
      const check = parsed.checks.find(
        (c: { id: string }) => c.id === "stellar-toml",
      );
      return { code, check };
    };

    beforeEach(() => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
      }) as unknown as typeof fetch;
      setFreeMemoryProviderForTest(() => 4_000_000_000);
    });

    afterEach(async () => {
      global.fetch = originalFetch;
      console.log = originalLog;
      setCommandRunnerForTest(undefined);
      setFreeMemoryProviderForTest(undefined);
      if (origCwd) process.chdir(origCwd);
      await Promise.all(tmpDirs.map((d) => fs.remove(d).catch(() => {})));
      tmpDirs.length = 0;
      jest.clearAllMocks();
    });

    it("passes as not-applicable when the file is absent", async () => {
      origCwd = process.cwd();
      await projectWithStellarToml(null);

      const { check } = await runDoctorJson();

      expect(check.ok).toBe(true);
      expect(check.required).toBe(false);
      expect(check.detail).toMatch(/not present/i);
    });

    it("warns (optional, exit 0) when placeholders are still in place", async () => {
      origCwd = process.cwd();
      const template = await fs.readFile(
        path.join(TEMPLATES_DIR, "default", STELLAR_TOML_REL),
        "utf8",
      );
      await projectWithStellarToml(template);

      const { code, check } = await runDoctorJson();

      expect(check.required).toBe(false);
      expect(check.ok).toBe(false);
      expect(check.detail).toContain("G_REPLACE_WITH_YOUR_ISSUER_ACCOUNT");
      expect(check.detail).toContain("REPLACE_WITH_ASSET_CODE");
      expect(check.fix).toMatch(/docs\/stellar-toml\.md/);
      // An optional check failing must never fail the overall doctor run.
      expect(code).toBe(0);
    });

    it("passes when the placeholders are filled in", async () => {
      origCwd = process.cwd();
      await projectWithStellarToml(FILLED_TOML);

      const { check } = await runDoctorJson();

      expect(check.ok).toBe(true);
      expect(check.required).toBe(false);
      expect(check.detail).toMatch(/no unresolved placeholders/i);
    });
  });
});
