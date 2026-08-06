export default {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  setupFilesAfterEnv: ['<rootDir>/node_modules/@testing-library/jest-dom/jest-globals.js'],
  transform: {
    '^.+\\.(t|j)sx?$': ['babel-jest', {
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' }, modules: false }],
        ['@babel/preset-react', { runtime: 'automatic' }],
        ['@babel/preset-typescript'],
      ],
    }],
  },
  moduleNameMapper: {
    '^\\.\\./contexts$': '<rootDir>/src/mocks/wallet-contexts-mock.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.test.tsx',
    '**/src/**/*.test.ts',
    '**/src/**/*.test.tsx',
    '**/__tests__/**/*.ts',
    '**/__tests__/**/*.tsx'
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
