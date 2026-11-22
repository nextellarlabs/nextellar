import { generateCiWorkflow } from "../src/lib/ci.js";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { scaffold } from "../src/lib/scaffold.js";

describe("generated project CI workflow (--with-ci)", () => {
  it("generates valid workflow for npm by default", () => {
    const yaml = generateCiWorkflow("npm");
    expect(yaml).toContain("name: CI");
    expect(yaml).toContain("npm ci");
    expect(yaml).toContain("npm run lint");
    expect(yaml).toContain("npm run type-check");
    expect(yaml).toContain("npm test");
    expect(yaml).toContain("npm run build");
  });

  it("generates valid workflow for yarn with frozen lockfile", () => {
    const yaml = generateCiWorkflow("yarn");
    expect(yaml).toContain("cache: yarn");
    expect(yaml).toContain("yarn install --frozen-lockfile");
    expect(yaml).toContain("yarn lint");
    expect(yaml).toContain("yarn test");
  });

  it("generates valid workflow for pnpm with action-setup", () => {
    const yaml = generateCiWorkflow("pnpm");
    expect(yaml).toContain("pnpm/action-setup@v3");
    expect(yaml).toContain("pnpm install --frozen-lockfile");
    expect(yaml).toContain("pnpm test");
  });

  it("generates valid workflow for bun with setup-bun", () => {
    const yaml = generateCiWorkflow("bun");
    expect(yaml).toContain("oven-sh/setup-bun@v2");
    expect(yaml).toContain("bun install --frozen-lockfile");
    expect(yaml).toContain("bun test");
  });

  it("writes .github/workflows/ci.yml when withCi option is true in scaffold", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nextellar-ci-test-"));
    const appDir = path.join(tmpDir, "my-ci-app");

    try {
      await scaffold({
        appName: appDir,
        useTs: true,
        template: "minimal",
        withCi: true,
        skipInstall: true,
        packageManager: "npm",
        git: false,
      });

      const ciWorkflowPath = path.join(appDir, ".github", "workflows", "ci.yml");
      expect(await fs.pathExists(ciWorkflowPath)).toBe(true);

      const content = await fs.readFile(ciWorkflowPath, "utf-8");
      expect(content).toContain("name: CI");
      expect(content).toContain("npm ci");
      expect(content).toContain("npm run build");
    } finally {
      await fs.remove(tmpDir);
    }
  });
});
