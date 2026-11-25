export default {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts", ".tsx", ".jsx"],
  setupFiles: ["<rootDir>/jest.setup.env.ts"],
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
    "^next/image$": "<rootDir>/tests/mocks/next-image.tsx",
    "^@/hooks/default/useTrustlines$":
      "<rootDir>/src/templates/default/src/hooks/useTrustlines.ts",
    "^@/hooks/default/useStellarBalances$":
      "<rootDir>/src/templates/default/src/hooks/useStellarBalances.ts",
    "^@/hooks/default/useStellarPayment$":
      "<rootDir>/src/templates/default/src/hooks/useStellarPayment.ts",
    "^@/hooks/default/useTransactionHistory$":
      "<rootDir>/src/templates/default/src/hooks/useTransactionHistory.ts",
    "^@/hooks/default/useOfferBook$":
      "<rootDir>/src/templates/default/src/hooks/useOfferBook.ts",
    "^@/hooks/default/useSorobanContract$":
      "<rootDir>/src/templates/default/src/hooks/useSorobanContract.ts",
    "^@/hooks/default/useSorobanEvents$":
      "<rootDir>/src/templates/default/src/hooks/useSorobanEvents.ts",
    "^@/hooks/default/useSep6$":
      "<rootDir>/src/templates/default/src/hooks/useSep6.ts",
    "^@/hooks/default/useSep38Quote$":
      "<rootDir>/src/templates/default/src/hooks/useSep38Quote.ts",
    "^@/hooks/default/useSep24Interactive$":
      "<rootDir>/src/templates/default/src/hooks/useSep24Interactive.ts",
    "^@/hooks/default/useSep30Recovery$":
      "<rootDir>/src/templates/default/src/hooks/useSep30Recovery.ts",
    "^@/hooks/default/useMultisigTransaction$":
      "<rootDir>/src/templates/default/src/hooks/useMultisigTransaction.ts",
    "^@/hooks/default/useHorizonStreaming$":
      "<rootDir>/src/templates/default/src/hooks/useHorizonStreaming.ts",
    "^@/hooks/default/useFederationLookup$":
      "<rootDir>/src/templates/default/src/hooks/useFederationLookup.ts",
    "^@/hooks/default/useContractUpgrade$":
      "<rootDir>/src/templates/default/src/hooks/useContractUpgrade.ts",
    "^@/hooks/default/useContractEventHistory$":
      "<rootDir>/src/templates/default/src/hooks/useContractEventHistory.ts",
    "^@/hooks/default/useContractDeploy$":
      "<rootDir>/src/templates/default/src/hooks/useContractDeploy.ts",
    "^@/hooks/default/useClipboard$":
      "<rootDir>/src/templates/default/src/hooks/useClipboard.ts",
    "^@/hooks/default/usePrefersReducedMotion$":
      "<rootDir>/src/templates/default/src/hooks/usePrefersReducedMotion.ts",
    "^@/hooks/default/useAccountData$":
      "<rootDir>/src/templates/default/src/hooks/useAccountData.ts",
    "^@/hooks/(.*)$": "<rootDir>/src/templates/defi/src/hooks/$1",
    "^@/lib/contracts$":
      "<rootDir>/src/templates/contracts-template/src/lib/contracts/index.ts",
    "^@/lib/(.*)$": "<rootDir>/src/templates/contracts-template/src/lib/$1",
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
    // backend/ and routes-d/ were removed from this repo (#684); these suites
    // import from them and cannot resolve.
    "<rootDir>/tests/auth/",
    "<rootDir>/tests/backend/",
    "<rootDir>/tests/middleware/",
    "<rootDir>/tests/routes/",
    "<rootDir>/tests/utils/response.test.ts",
    // Scratch app scaffolded by tests/cli-entry.test.ts.
    "<rootDir>/tests/tmp-test-app/",
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
