import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATES_DIR = path.join(__dirname, "../src/templates");

/** Scaffold app templates that must ship a documented env surface. */
const APP_TEMPLATES = [
  "default",
  "minimal",
  "defi",
  "js-template",
  "js-minimal",
  "js-defi",
];

const REQUIRED_PLACEHOLDERS = [
  "{{HORIZON_URL}}",
  "{{SOROBAN_URL}}",
  "{{NETWORK}}",
  "{{APP_NAME}}",
];

describe("template .env.example parity", () => {
  test("every app template ships an .env.example", async () => {
    for (const name of APP_TEMPLATES) {
      const envPath = path.join(TEMPLATES_DIR, name, ".env.example");
      expect(await fs.pathExists(envPath)).toBe(true);
    }
  });

  test("app template .env.example files share required placeholder tokens", async () => {
    const defaultEnv = await fs.readFile(
      path.join(TEMPLATES_DIR, "default", ".env.example"),
      "utf8",
    );

    for (const placeholder of REQUIRED_PLACEHOLDERS) {
      expect(defaultEnv).toContain(placeholder);
    }

    for (const name of APP_TEMPLATES) {
      const env = await fs.readFile(
        path.join(TEMPLATES_DIR, name, ".env.example"),
        "utf8",
      );
      for (const placeholder of REQUIRED_PLACEHOLDERS) {
        expect(env).toContain(placeholder);
      }
    }
  });
});
