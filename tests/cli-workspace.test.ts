import { execa } from "execa";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Runs the built CLI, like tests/cli-entry.test.ts (requires `npm run build`).
const cli = path.resolve(__dirname, "../dist/bin/nextellar.js");

describe("nextellar CLI --workspace (#1117)", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "nextellar-cli-ws-")),
    );
  });

  afterEach(async () => {
    await fs.remove(tmp);
  });

  it("--workspace-root scaffolds into the workspace's apps folder", async () => {
    await fs.writeJson(path.join(tmp, "package.json"), {
      name: "mono",
      private: true,
      workspaces: ["apps/*"],
    });

    const { exitCode, stdout } = await execa(
      "node",
      [cli, "web", "--workspace-root", tmp, "--defaults", "--skip-install"],
      { cwd: tmp, env: { NEXTELLAR_TELEMETRY_DISABLED: "1" } },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("✔ Nextellar scaffold complete!");
    expect(stdout).toContain(`cd ${path.join("apps", "web")}`);
    expect(
      await fs.pathExists(path.join(tmp, "apps", "web", "package.json")),
    ).toBe(true);
  }, 30000);

  it("--workspace fails with a clear error outside a workspace", async () => {
    await fs.writeJson(path.join(tmp, "package.json"), { name: "plain" });

    const { exitCode, all } = await execa(
      "node",
      [cli, "web", "--workspace-root", tmp, "--defaults", "--skip-install"],
      {
        cwd: tmp,
        reject: false,
        all: true,
        env: { NEXTELLAR_TELEMETRY_DISABLED: "1" },
      },
    );

    expect(exitCode).toBe(1);
    expect(all).toContain("No workspace found");
    expect(await fs.pathExists(path.join(tmp, "apps"))).toBe(false);
  }, 30000);
});
