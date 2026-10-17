// Mutation-testing pilot for the core CLI library (#1088).
// Not gating CI yet: see docs/mutation-testing.md for how to run it, how the
// baseline in docs/mutation-baseline.json is recorded, and how to read the
// report.
/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  packageManager: "npm",
  testRunner: "jest",
  // The suite runs as native ESM (see the "test" script in package.json).
  testRunnerNodeArgs: ["--experimental-vm-modules", "--no-warnings"],
  jest: {
    projectType: "custom",
    configFile: "jest.config.mjs",
    // Only run the tests related to the mutated file, so a src/lib mutant
    // doesn't pay for the whole template component suite.
    enableFindRelatedTests: true,
  },
  mutate: ["src/lib/**/*.ts", "!src/lib/**/*.d.ts"],
  // perTest coverage analysis relies on instrumenting the Jest environment,
  // which is not reliable under native ESM; findRelatedTests keeps "off" fast.
  coverageAnalysis: "off",
  incremental: true,
  incrementalFile: "reports/mutation/stryker-incremental.json",
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/mutation.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  // Report-only for the pilot: colour bands in the report, never a failure.
  thresholds: { high: 80, low: 60, break: null },
  ignorePatterns: ["dist", "coverage", "reports", ".stryker-tmp"],
  tempDirName: ".stryker-tmp",
  timeoutMS: 60000,
  concurrency: 2,
};
