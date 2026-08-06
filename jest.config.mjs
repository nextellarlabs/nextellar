export default {
  testEnvironment: 'node',
  // .tsx is included so component tests can use ESM imports, matching .ts
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  setupFilesAfterEnv: [],
  transform: {
    '^.+\\.[tj]sx?$': ['babel-jest', {
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' }, modules: false }],
        ['@babel/preset-typescript'],
        // Automatic runtime: JSX compiles without an explicit React import
        ['@babel/preset-react', { runtime: 'automatic' }],
      ],
    }],
  },
  moduleNameMapper: {
    '^\\.\\./contexts$': '<rootDir>/src/mocks/wallet-contexts-mock.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.test.tsx',
    '**/src/**/*.test.ts',
    '**/__tests__/**/*.ts'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    // E2E tests are gated behind NEXTELLAR_E2E=1 and explicitly skipped in the test file
    // but we keep them in testMatch so they can be run when needed
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts'
  ]
};
