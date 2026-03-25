import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import path from "path";
import fs from "fs-extra";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mock the features module at the top level
jest.unstable_mockModule("../src/lib/features.js", () => ({
  getFeature: jest.fn(),
  resolveFeatureWithDeps: jest.fn(),
}));

// We need to import the module that uses the mock AFTER the mock is defined
const { runAdd } = await import("../src/lib/add.js");
const { getFeature, resolveFeatureWithDeps } = await import("../src/lib/features.js") as any;

describe("runAdd path traversal protection", () => {
  const testDir = path.join(__dirname, "..", "test-temp-add");

  beforeEach(async () => {
    await fs.ensureDir(testDir);
    // Create a minimal package.json
    await fs.writeJson(path.join(testDir, "package.json"), {
      name: "test-project",
      dependencies: {},
    });
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it("should throw error when relativePath tries to escape with ../../", async () => {
    const mockFeature = {
      id: "malicious",
      label: "Malicious Feature",
      description: "Test",
      files: ["../../.env"],
      npmDependencies: [],
      dependencies: [],
    };

    getFeature.mockReturnValue(mockFeature);
    resolveFeatureWithDeps.mockReturnValue([mockFeature]);

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

    getFeature.mockReturnValue(mockFeature);
    resolveFeatureWithDeps.mockReturnValue([mockFeature]);

    // This should not throw a path traversal error
    try {
      await runAdd("safe", {
        cwd: testDir,
        skipInstall: true,
        force: true,
      });
    } catch (e: any) {
      // We don't care if it fails because of missing template files,
      // as long as it's not the traversal error.
      expect(e.message).not.toContain("Feature file path escapes project directory");
    }
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

    getFeature.mockReturnValue(mockFeature);
    resolveFeatureWithDeps.mockReturnValue([mockFeature]);

    await expect(
      runAdd("absolute", { cwd: testDir, skipInstall: true })
    ).rejects.toThrow("Feature file path escapes project directory");
  });
});
