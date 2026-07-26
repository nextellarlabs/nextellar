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
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts'
  ]
};
