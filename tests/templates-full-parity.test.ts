/**
 * The `full` template is an overlay on `default` (see scaffold.ts), and the files it
 * carries must stay byte-for-byte what the default template ships, or a scaffolded
 * `full` app silently diverges from `default` (#1199, #1201, #1204).
 *
 * Reads the files directly, so it does not depend on either template's module graph.
 */
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(__dirname, "../src/templates");
const read = (template: string, rel: string) =>
  fs.readFile(path.join(TEMPLATES, template, rel), "utf8");
const has = (template: string, rel: string) =>
  fs.pathExists(path.join(TEMPLATES, template, rel));

/** Core wallet and account components (#1199). */
const WALLET_COMPONENTS = [
  "WalletConnectButton",
  "AccountSwitcher",
  "NetworkSwitcher",
  "NetworkMismatchBanner",
];

/** UI utilities (#1201). `SkeletonList` is exported from `Skeleton.tsx`. */
const UI_COMPONENTS = [
  "CopyButton",
  "EmptyState",
  "ErrorBoundary",
  "LoadingBoundary",
  "Skeleton",
  "ThemeToggle",
];

/** Soroban and advanced hooks (#1204). */
const SOROBAN_HOOKS = [
  "useSorobanContract",
  "useSorobanEvents",
  "useContractDeploy",
  "useContractUpgrade",
  "useContractEventHistory",
];

/** Hooks the ported components import. */
const SUPPORT_HOOKS = ["useClipboard", "usePrefersReducedMotion"];

const components = [...WALLET_COMPONENTS, ...UI_COMPONENTS];
const hooks = [...SOROBAN_HOOKS, ...SUPPORT_HOOKS];

describe("full template mirrors default", () => {
  test.each(components)(
    "component %s exists and matches default",
    async (name) => {
      const rel = `src/components/${name}.tsx`;
      expect(await has("full", rel)).toBe(true);
      expect(await read("full", rel)).toBe(await read("default", rel));
    },
  );

  test.each(hooks)("hook %s exists and matches default", async (name) => {
    const rel = `src/hooks/${name}.ts`;
    expect(await has("full", rel)).toBe(true);
    expect(await read("full", rel)).toBe(await read("default", rel));
  });

  test.each(components.filter((n) => n !== "ErrorBoundary"))(
    "story for %s matches default",
    async (name) => {
      const rel = `src/components/${name}.stories.tsx`;
      expect(await has("full", rel)).toBe(await has("default", rel));
      if (await has("default", rel)) {
        expect(await read("full", rel)).toBe(await read("default", rel));
      }
    },
  );

  test("SkeletonList is exported by the full Skeleton component", async () => {
    expect(await read("full", "src/components/Skeleton.tsx")).toMatch(
      /export (function|const) SkeletonList\b/,
    );
  });

  test("every hook has a full-template test", async () => {
    const tests = (await fs.readdir(path.join(__dirname, "hooks"))).filter(
      (f) => f.includes(".full."),
    );
    for (const name of SOROBAN_HOOKS.filter(
      (n) => n !== "useSorobanContract",
    )) {
      expect(tests.some((f) => f.startsWith(`${name}.full.`))).toBe(true);
    }
  });

  test("every component the full page imports exists in full or default", async () => {
    const page = await read("full", "src/app/page.tsx");
    const imports = [...page.matchAll(/from '\.\.\/components\/(\w+)'/g)].map(
      (m) => m[1],
    );
    expect(imports.length).toBeGreaterThan(0);
    for (const name of imports) {
      expect(await has("full", `src/components/${name}.tsx`)).toBe(true);
    }
  });
});
