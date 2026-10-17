import { jest } from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { runStatus } from "../src/lib/status.js";

describe("nextellar status", () => {
  const tmpDirs: string[] = [];
  let logSpy: jest.SpyInstance;
  let origEnv: NodeJS.ProcessEnv;

  const output = () => logSpy.mock.calls.map((c) => c.join(" ")).join("\n");

  const makeProject = async (
    opts: {
      template?: string;
      envExample?: string;
      envLocal?: string;
      git?: boolean;
      nextellarVersion?: string;
    } = {},
  ) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nextellar-status-"));
    tmpDirs.push(dir);

    await fs.outputJson(path.join(dir, ".nextellar/config.json"), {
      template: opts.template ?? "default",
      nextellarVersion: opts.nextellarVersion ?? "1.0.0",
    });
    await fs.outputJson(path.join(dir, "package.json"), { name: "demo" });

    if (opts.envExample !== undefined) {
      await fs.outputFile(path.join(dir, ".env.example"), opts.envExample);
    }
    if (opts.envLocal !== undefined) {
      await fs.outputFile(path.join(dir, ".env.local"), opts.envLocal);
    }
    if (opts.git) {
      await fs.ensureDir(path.join(dir, ".git"));
    }

    return dir;
  };

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    origEnv = { ...process.env };
  });

  afterEach(async () => {
    logSpy.mockRestore();
    process.env = origEnv;
    await Promise.all(tmpDirs.map((d) => fs.remove(d).catch(() => {})));
    tmpDirs.length = 0;
  });

  it("errors when .nextellar/config.json is missing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nextellar-status-"));
    tmpDirs.push(dir);
    await expect(runStatus({ cwd: dir })).rejects.toThrow(
      /Not a Nextellar project/,
    );
  });

  it("reports full health when env vars are set, git is initialized, and telemetry is off", async () => {
    const dir = await makeProject({
      envExample: "NEXT_PUBLIC_HORIZON_URL=x\nNEXT_PUBLIC_NETWORK=y\n",
      envLocal: "NEXT_PUBLIC_HORIZON_URL=real\nNEXT_PUBLIC_NETWORK=testnet\n",
      git: true,
    });

    const code = await runStatus({ cwd: dir });

    expect(code).toBe(0);
    const out = output();
    expect(out).toContain("Health score: 5/5");
    expect(out).toMatch(/✔.*Git repository/);
  });

  it("flags missing env vars declared in .env.example", async () => {
    const dir = await makeProject({
      envExample: "NEXT_PUBLIC_HORIZON_URL=x\nNEXT_PUBLIC_NETWORK=y\n",
      envLocal: "NEXT_PUBLIC_HORIZON_URL=real\n", // NEXT_PUBLIC_NETWORK missing
    });

    const code = await runStatus({ cwd: dir });

    expect(code).toBe(1);
    expect(output()).toContain("Missing from .env.local: NEXT_PUBLIC_NETWORK");
  });

  it("treats env vars satisfied via process.env as present", async () => {
    process.env.NEXT_PUBLIC_NETWORK = "testnet";
    const dir = await makeProject({
      envExample: "NEXT_PUBLIC_NETWORK=y\n",
      git: true,
    });

    const code = await runStatus({ cwd: dir });

    expect(code).toBe(0);
    expect(output()).not.toContain("Missing from .env.local");
  });

  it("ignores commented-out and blank lines in .env.example", async () => {
    const dir = await makeProject({
      envExample: "# NEXT_PUBLIC_OPTIONAL=z\n\nNEXT_PUBLIC_REQUIRED=x\n",
      envLocal: "NEXT_PUBLIC_REQUIRED=set\n",
      git: true,
    });

    const code = await runStatus({ cwd: dir });

    expect(code).toBe(0);
    expect(output()).not.toContain("NEXT_PUBLIC_OPTIONAL");
  });

  it("reports no env check needed when there is no .env.example", async () => {
    const dir = await makeProject({});

    const code = await runStatus({ cwd: dir });

    expect(output()).toContain("nothing to check");
    expect(code).toBe(1); // git not initialized in this fixture, so overall still degraded
  });

  it("flags an uninitialized git repository", async () => {
    const dir = await makeProject({ git: false });

    await runStatus({ cwd: dir });

    expect(output()).toMatch(/⚠.*Git repository.*Not a git repository/);
  });

  it("flags outdated Stellar dependencies against the resolved template", async () => {
    const dir = await makeProject({ template: "default" });
    await fs.outputJson(path.join(dir, "package.json"), {
      name: "demo",
      dependencies: { "@stellar/stellar-sdk": "0.0.1" },
    });

    await runStatus({ cwd: dir });

    expect(output()).toMatch(/Outdated: @stellar\/stellar-sdk/);
    expect(output()).toContain("nextellar upgrade");
  });

  it("reports telemetry status as healthy in either enabled or disabled state", async () => {
    process.env.NEXTELLAR_TELEMETRY_DISABLED = "1";
    const dir = await makeProject({});

    await runStatus({ cwd: dir });

    expect(output()).toMatch(
      /✔.*Telemetry.*Disabled via NEXTELLAR_TELEMETRY_DISABLED/,
    );
  });

  it("emits a JSON report with the documented schema when --json is passed", async () => {
    const dir = await makeProject({ git: true });

    const code = await runStatus({ cwd: dir, json: true });
    const parsed = JSON.parse(output());

    expect(code).toBe(0);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.maxScore).toBe(5);
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.checks.map((c: { id: string }) => c.id)).toEqual([
      "project",
      "dependencies",
      "env",
      "telemetry",
      "git",
    ]);
  });

  it("includes the scaffolded CLI version in the project check detail", async () => {
    const dir = await makeProject({ nextellarVersion: "1.2.3" });

    await runStatus({ cwd: dir });

    expect(output()).toContain("scaffolded with v1.2.3");
  });
});
