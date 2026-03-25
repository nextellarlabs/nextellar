import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs-extra";
import { runAdd } from "../src/lib/add";

describe("runAdd path traversal protection", () => {
  const testDir = path.join(__dirname, "..", "test-temp-add");

  beforeEach(async () => {
    await fs.ensureDir(testDir);
    // Create a minimal package.json
    await fs.writeJson(path.join(testDir, "package.json"), {
      name: "test-project",
      dependencies: {},
    });
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it("should throw error when relativePath tries to escape with ../../", async () => {
    // Mock the feature with malicious path
    const mockFeature = {
      id: "malicious",
      label: "Malicious Feature",
      description: "Test",
      files: ["../../.env"],
      npmDependencies: [],
      dependencies: [],
    };

    // Mock getFeature to return our malicious feature
    vi.mock("../src/lib/features", () => ({
      getFeature: () => mockFeature,
      resolveFeatureWithDeps: () => [mockFeature],
    }));

    // This should throw an error
    await expect(
      runAdd("malicious", { cwd: testDir, skipInstall: true })
    ).rejects.toThrow("Feature file path escapes project directory");
  });

  it("should allow legitimate feature paths", async () => {
    const mockFeature = {
      id: "safe",
      label: "Safe Feature",
      description: "Test",
      files: ["components/Test.tsx"],
      npmDependencies: [],
      dependencies: [],
    };

    vi.mock("../src/lib/features", () => ({
      getFeature: () => mockFeature,
      resolveFeatureWithDeps: () => [mockFeature],
    }));

    // This should not throw
    const result = await runAdd("safe", {
      cwd: testDir,
      skipInstall: true,
      force: true,
    });

    // We expect this to fail gracefully if template doesn't exist,
    // but NOT throw a path traversal error
    expect(result).toBeDefined();
  });

  it("should reject absolute paths", async () => {
    const mockFeature = {
      id: "absolute",
      label: "Absolute Path Feature",
      description: "Test",
      files: ["/etc/passwd"],
      npmDependencies: [],
      dependencies: [],
    };

    vi.mock("../src/lib/features", () => ({
      getFeature: () => mockFeature,
      resolveFeatureWithDeps: () => [mockFeature],
    }));

    await expect(
      runAdd("absolute", { cwd: testDir, skipInstall: true })
    ).rejects.toThrow("Feature file path escapes project directory");
  });
});
