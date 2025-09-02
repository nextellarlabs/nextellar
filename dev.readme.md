# Developer Guide - Nextellar CLI

This guide is for developers who want to contribute to the Nextellar CLI project. It explains the project structure, development workflow, and how to make changes safely.

## Project Overview

Nextellar is a CLI tool that scaffolds Next.js applications with built-in Stellar blockchain support. The project consists of:

1. **CLI Tool** - The core scaffolding engine (this repository)
2. **Template Projects** - Next.js + Stellar starter templates that get copied to user projects

## Architecture

### Core Concept

```
CLI Tool (nextellar) → Scaffolds → User Projects (with Stellar hooks)
```

- **CLI has NO Stellar dependencies** - Keeps it lightweight and fast
- **Templates contain Stellar code** - Full SDK, hooks, and components
- **Scaffolding copies templates** - Users get production-ready Stellar dApps

### Key Design Principles

1. **Separation of Concerns**: CLI logic separate from Stellar functionality
2. **Template-based**: All user code lives in templates, not CLI
3. **ESM Throughout**: Modern ES modules for better performance
4. **Type Safety**: Full TypeScript coverage

## File Structure

```
nextellar/
├── bin/
│   └── nextellar.ts              # CLI entry point (Commander.js)
├── src/
│   ├── lib/
│   │   ├── scaffold.ts           # Core scaffolding logic
│   │   └── install.ts            # Package installation handling
│   ├── mocks/                    # MSW mock handlers for testing
│   └── templates/
│       └── ts-template/          # Next.js + TypeScript template
│           ├── package.json      # Template dependencies (includes Stellar SDK)
│           ├── src/
│           │   ├── hooks/
│           │   │   ├── useStellarWallet.ts      # Wallet connection hook
│           │   │   ├── useStellarBalances.ts    # Balance fetching hook
│           │   │   └── useStellarPayment.ts     # Payment transactions hook
│           │   ├── lib/
│           │   │   └── stellar-wallet-kit.ts   # Wallet configuration
│           │   └── components/
│           │       └── WalletConnectButton.tsx # UI components
│           └── [other Next.js files]
├── tests/
│   ├── hooks/                    # Tests for template hooks
│   ├── cli-entry.test.ts         # CLI command tests
│   └── install.test.ts           # Installation tests
├── tsconfig.json                 # Main TypeScript config
├── tsconfig.build.json           # Build-specific config (excludes templates)
├── jest.config.mjs               # Test configuration
├── package.json                  # CLI dependencies (NO Stellar SDK)
├── CLAUDE.md                     # Claude Code guidance
└── CONTRIBUTING.md               # Contribution guidelines
```

## Development Workflow

### Setting Up Development Environment

```bash
# Clone and setup
git clone <repo-url>
cd nextellar
npm install

# Build the CLI
npm run build

# Link for local testing
npm link

# Test scaffolding
nextellar test-app --skip-install
cd test-app
npm install
npm run dev
```

### Key Commands

```bash
# Development
npm run build          # Compile TypeScript to dist/
npm start              # Run CLI with ts-node (dev mode)
npm test               # Run all tests
npm run lint           # Run ESLint (if configured)

# Testing CLI locally
npm link               # Make CLI available globally
nextellar --help       # Test CLI commands
nextellar my-app       # Test full scaffolding

# Clean up
npm unlink             # Remove global link
```

### Development Guidelines

#### 1. CLI Changes (src/lib/)

When modifying CLI logic:

```typescript
// ✅ Good: CLI code should be framework-agnostic
export async function scaffold(options: ScaffoldOptions) {
  // Template copying logic
}

// ❌ Bad: Don't import Stellar SDK in CLI
import { Horizon } from '@stellar/stellar-sdk'; // This breaks build!
```

#### 2. Template Changes (src/templates/)

When modifying user-facing code:

```typescript
//  Good: Template code can use any dependencies
import { Horizon } from '@stellar/stellar-sdk';
import React from 'react';

//  Good: Templates should be production-ready
export function useStellarPayment() {
  // Full implementation with error handling
}
```

#### 3. Testing Strategy

```typescript
// CLI Tests: Mock external dependencies
jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: { Server: jest.fn() }
}));

// Template Tests: Test against mocked APIs
const { result } = renderHook(() => useStellarPayment());
```

## Making Changes

### Adding New Hooks

1. **Create in template directory**:
   ```bash
   #  Correct location
   src/templates/ts-template/src/hooks/useNewHook.ts
   
   #  Wrong - this breaks CLI build
   src/lib/hooks/useNewHook.ts
   ```

2. **Follow existing patterns**:
   ```typescript
   'use client';
   import { useState, useCallback } from 'react';
   import { Horizon } from '@stellar/stellar-sdk';
   
   export function useNewHook() {
     // Implementation
   }
   ```

3. **Add tests**:
   ```bash
   tests/hooks/useNewHook.test.ts
   ```

### Modifying CLI Logic

1. **Update core files**:
   - `src/lib/scaffold.ts` - Template copying
   - `src/lib/install.ts` - Package installation
   - `bin/nextellar.ts` - CLI commands

2. **Build configuration**:
   ```json
   // tsconfig.build.json excludes templates
   {
     "exclude": ["src/templates", "tests"]
   }
   ```

3. **Test changes**:
   ```bash
   npm run build        # Must succeed without Stellar SDK
   nextellar test-app   # Test scaffolding works
   ```

### Adding New Templates

1. **Create template directory**:
   ```bash
   src/templates/js-template/    # For JavaScript variant
   src/templates/custom-template/ # For specialized use cases
   ```

2. **Update scaffold.ts**:
   ```typescript
   // Add template selection logic
   const templateDir = options.useJs 
     ? 'js-template' 
     : 'ts-template';
   ```

## Common Pitfalls

### ❌ Don't Do This

```typescript
// Don't add Stellar imports to CLI code
import { Horizon } from '@stellar/stellar-sdk'; // Breaks build!

// Don't put hooks in CLI source
src/lib/hooks/useStuff.ts // Wrong location!

// Don't include templates in CLI build
// tsconfig.build.json should exclude src/templates
```

###  Do This Instead

```typescript
// Keep CLI code framework-agnostic
export async function copyTemplate(from: string, to: string) {
  await fs.copy(from, to);
}

// Put hooks in templates
src/templates/ts-template/src/hooks/useStuff.ts // Correct!

// Templates can use any dependencies
dependencies: {
  "@stellar/stellar-sdk": "^12.3.0"  // Only in template package.json
}
```

## Testing

### Unit Tests

```bash
npm test                    # All tests
npm test -- cli-entry      # Specific test file
npm test -- --watch        # Watch mode
```

### Integration Testing

```bash
# Test full scaffolding workflow
nextellar test-integration --skip-install
cd test-integration
npm install
npm run build              # Should succeed
npm test                   # Template tests should pass
```

### Template Testing

```bash
# Test hooks work in scaffolded projects
cd test-integration
npm test                   # Runs template's test suite
```

## Release Process

1. **Verify everything builds**:
   ```bash
   npm run build          # CLI must build without Stellar
   npm test               # All tests pass
   ```

2. **Test scaffolding**:
   ```bash
   nextellar test-release
   cd test-release
   npm install && npm run build && npm test
   ```

3. **Version and publish**:
   ```bash
   npm version patch/minor/major
   npm publish
   ```

## Troubleshooting

### "Cannot resolve '@stellar/stellar-sdk'" during CLI build

**Cause**: Stellar imports in CLI code  
**Fix**: Move code to templates or mock the import

### "Hook tests failing"

**Cause**: Missing mocks or incorrect import paths  
**Fix**: Check mock setup in test files

### "Scaffolded app missing hooks"

**Cause**: Hooks not in template directory  
**Fix**: Move hooks to `src/templates/ts-template/src/hooks/`

## Getting Help

1. **Check existing patterns**: Look at `useStellarBalances.ts` for hook patterns
2. **Review tests**: Test files show expected behavior
3. **Check CLAUDE.md**: Has Claude Code guidance for AI assistance
4. **Read CONTRIBUTING.md**: Official contribution guidelines

## Key Files for New Contributors

Start by understanding these files:

1. `bin/nextellar.ts` - CLI entry point
2. `src/lib/scaffold.ts` - Core scaffolding logic  
3. `src/templates/ts-template/src/hooks/useStellarBalances.ts` - Example hook
4. `tests/cli-entry.test.ts` - CLI testing patterns
5. `tests/hooks/useStellarBalances.test.ts` - Hook testing patterns

Happy contributing! 