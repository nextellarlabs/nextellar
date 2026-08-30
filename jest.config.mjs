export default {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts", ".tsx", ".jsx"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.jest-dom.ts"],
  transform: {
    // The js-* templates ship their own package.json with no "type" field, so
    // Jest classifies their plain .js modules (src/config, src/lib) as CJS,
    // while the ESM transform below emits `export` statements — importing one
    // throws "Unexpected export statement in CJS module". Their .jsx files
    // escape this only because extensionsToTreatAsEsm covers .jsx. Compile
    // just these .js modules to CJS so they load under the classification
    // Jest already gives them.
    "templates[\\\\/]js-[^\\\\/]+[\\\\/]src[\\\\/].+\\.js$": [
      "babel-jest",
      {
        presets: [
          ["@babel/preset-env", { targets: { node: "current" } }],
          ["@babel/preset-react", { runtime: "automatic" }],
        ],
      },
    ],
    "^.+\\.[tj]sx?$": [
      "babel-jest",
      {
        presets: [
          [
            "@babel/preset-env",
            { targets: { node: "current" }, modules: false },
          ],
          ["@babel/preset-react", { runtime: "automatic" }],
          ["@babel/preset-typescript"],
        ],
      },
    ],
  },
  moduleNameMapper: {
    "^\\.\\./contexts$": "<rootDir>/src/mocks/wallet-contexts-mock.ts",
    "^\\.\\./contexts/WalletProvider$":
      "<rootDir>/src/mocks/wallet-contexts-mock.ts",
    "^@clack/prompts$": "<rootDir>/tests/mocks/clack-prompts.js",
    "^@/hooks/(.*)$": "<rootDir>/src/templates/defi/src/hooks/$1",
    "^@/lib/contracts$":
      "<rootDir>/src/templates/contracts-template/src/lib/contracts/index.ts",
    "^@/lib/(.*)$": "<rootDir>/src/templates/contracts-template/src/lib/$1",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
  testMatch: [
    "**/tests/**/*.test.ts",
    "**/tests/**/*.test.tsx",
    "**/src/**/*.test.ts",
    "**/src/**/*.test.tsx",
    "**/__tests__/**/*.ts",
    "**/__tests__/**/*.tsx",
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    // E2E tests are gated behind NEXTELLAR_E2E=1 and explicitly skipped in the test file
    // but we keep them in testMatch so they can be run when needed
  ],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
  // Regression floor, not an aspirational target (#936). Set below the
  // current real baseline (lines 32.1%, statements 31.8%, functions 34.1%,
  // branches 27.7% as of this commit) so day-to-day fluctuation doesn't
  // flake-fail CI — this exists to catch a large new untested addition to
  // src/lib/, not to block current work. Raise it deliberately alongside
  // real test-coverage improvements, not as a drive-by PR change.
  coverageThreshold: {
    global: {
      lines: 30,
      statements: 30,
      functions: 30,
      branches: 25,
    },
  },
};
