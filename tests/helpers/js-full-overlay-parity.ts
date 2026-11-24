import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const TEMPLATES = join(process.cwd(), "src", "templates");
const EXTENSIONS = [
  "",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  "/index.js",
  "/index.jsx",
];

/**
 * Shared assertions for a component copied from the `js-template` base into
 * the `js-full` overlay. The overlay merges onto that base at scaffold time,
 * so parity and resolvable relative imports are the contract to pin.
 */
export function expectJsFullComponentPort(name: string): void {
  const relative = join("src", "components", `${name}.jsx`);
  const sourcePath = join(TEMPLATES, "js-full", relative);
  const basePath = join(TEMPLATES, "js-template", relative);

  it(`${name} matches the js-template counterpart byte-for-byte`, () => {
    expect(readFileSync(sourcePath, "utf8")).toBe(
      readFileSync(basePath, "utf8"),
    );
  });

  it(`${name} keeps every relative import resolvable after the overlay merge`, () => {
    const source = readFileSync(sourcePath, "utf8");
    const imports = [...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map(
      (match) => match[1]!,
    );

    for (const specifier of imports) {
      const inOverlay = resolve(dirname(sourcePath), specifier);
      const inBase = resolve(dirname(basePath), specifier);
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
