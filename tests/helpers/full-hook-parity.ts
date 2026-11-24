import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const TEMPLATES = join(process.cwd(), "src", "templates");
const EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  "/index.ts",
  "/index.tsx",
];

/**
 * Shared assertions for a hook ported from `default` into the `full` overlay.
 * Overlay files are merged onto the base template, so byte-for-byte parity and
 * resolvable relative imports are the contract being tested — not a duplicate
 * copy of the default hook's behavioural suite.
 */
export function expectFullHookPort(name: string): void {
  const relative = join("src", "hooks", `${name}.ts`);
  const sourcePath = join(TEMPLATES, "full", relative);
  const defaultPath = join(TEMPLATES, "default", relative);

  it("matches the default hook byte-for-byte", () => {
    expect(readFileSync(sourcePath, "utf8")).toBe(
      readFileSync(defaultPath, "utf8"),
    );
  });

  it("exports the hook", () => {
    expect(readFileSync(sourcePath, "utf8")).toMatch(
      new RegExp(`export\\s+(?:function|const)\\s+${name}\\b`),
    );
  });

  it("keeps every relative import resolvable after the overlay merge", () => {
    const source = readFileSync(sourcePath, "utf8");
    const imports = [...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map(
      (match) => match[1]!,
    );

    for (const specifier of imports) {
      const inOverlay = resolve(dirname(sourcePath), specifier);
      const inBase = resolve(dirname(defaultPath), specifier);
      const resolvable = EXTENSIONS.some(
        (extension) =>
          existsSync(`${inOverlay}${extension}`) ||
          existsSync(`${inBase}${extension}`),
      );
      if (!resolvable) {
        throw new Error(`${name}: unresolved relative import ${specifier}`);
      }
      expect(resolvable).toBe(true);
    }
  });
}
