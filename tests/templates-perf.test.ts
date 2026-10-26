import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATES_DIR = path.join(__dirname, "../src/templates");

/** App templates that ship a Next.js app shell (layout + page + next.config). */
const APP_TEMPLATES = [
  { name: "default", configFile: "next.config.ts", layoutFile: "layout.tsx" },
  { name: "minimal", configFile: "next.config.ts", layoutFile: "layout.tsx" },
  { name: "defi", configFile: "next.config.ts", layoutFile: "layout.tsx" },
  {
    name: "js-template",
    configFile: "next.config.js",
    layoutFile: "layout.jsx",
  },
  { name: "js-defi", configFile: "next.config.js", layoutFile: "layout.jsx" },
];

describe("template image and font optimization (#947)", () => {
  test.each(APP_TEMPLATES)(
    "$name next.config opts into modern image formats",
    async ({ name, configFile }) => {
      const configPath = path.join(TEMPLATES_DIR, name, configFile);
      expect(await fs.pathExists(configPath)).toBe(true);

      const contents = await fs.readFile(configPath, "utf8");
      expect(contents).toContain("images");
      expect(contents).toContain("image/avif");
      expect(contents).toContain("image/webp");
    },
  );

  test.each(APP_TEMPLATES)(
    "$name layout uses next/font instead of a raw stylesheet/link import",
    async ({ name, layoutFile }) => {
      const layoutPath = path.join(TEMPLATES_DIR, name, "src/app", layoutFile);
      expect(await fs.pathExists(layoutPath)).toBe(true);

      const contents = await fs.readFile(layoutPath, "utf8");
      expect(contents).toContain("next/font");
      expect(contents).not.toMatch(/<link[^>]*fonts\.googleapis/);
    },
  );

  test.each(APP_TEMPLATES)(
    "$name has no raw <img> tags (uses next/image everywhere)",
    async ({ name }) => {
      const srcDir = path.join(TEMPLATES_DIR, name, "src");
      const entries = await fs.readdir(srcDir, {
        recursive: true,
        withFileTypes: true,
      });

      // Filter on the directory entry itself rather than a separate stat()
      // call, so there's no check-then-read window.
      const componentFiles = entries
        .filter((e) => e.isFile())
        .map((e) => path.join(e.parentPath, e.name))
        .filter((f) => /\.(tsx|jsx)$/.test(f) && !/__tests__|\.test\./.test(f));

      for (const fullPath of componentFiles) {
        const contents = await fs.readFile(fullPath, "utf8");
        expect(contents).not.toMatch(/<img\s/);
      }
    },
  );
});
