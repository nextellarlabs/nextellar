import { jest } from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Genuine ESM module (this file uses import.meta.url below), so mocking
// needs jest.unstable_mockModule rather than the classic jest.mock — the
// latter relies on babel's hoist-to-require transform, which doesn't apply
// once Jest is actually running the file as ESM (--experimental-vm-modules).
const mockRunInstall = jest.fn();
jest.unstable_mockModule('../src/lib/install.js', () => ({
  detectPackageManager: () => 'npm',
  runInstall: mockRunInstall,
}));

const mockExeca = jest.fn();
jest.unstable_mockModule('execa', () => ({ execa: mockExeca }));
// Disable the preflight toolchain gate in tests (#908): the sandboxed test
// environment cannot spawn npm, and scaffold behavior is what we verify here.
jest.unstable_mockModule('../src/lib/preflight.js', () => ({
  runPreflight: async () => ({ ok: true, failures: [] }),
  setPreflightDisabledForTest: () => {},
  setNpmRunnerForTest: () => {},
  checkNodeVersion: () => ({ ok: true, detail: 'test', fix: '' }),
  checkNpmAvailable: async () => ({ ok: true, detail: 'test npm OK', fix: '' }),
}));

const { scaffold } = await import('../src/lib/scaffold');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

jest.setTimeout(30000);

describe('scaffold integration', () => {
  let origCwd: string | undefined;
  const tmpParents: string[] = [];

  const makeTempParent = async (prefix = 'nextellar-test-') => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    tmpParents.push(dir);
    return dir;
  };

  // Simulate a failure during the copy phase after some files have already
  // been written into the target, so cleanup assertions prove a populated
  // directory was actually removed (not just that nothing was created).
  const expectCopyPhaseFailure = async (appName: string) => {
    const copySpy = jest.spyOn(fs, 'copy').mockImplementation(async (_source, destination) => {
      const targetDir = path.resolve(destination.toString());
      await fs.ensureDir(targetDir);
      await fs.writeFile(path.join(targetDir, 'partial.txt'), 'partial scaffold');
      throw new Error('copy phase failed');
    });

    try {
      await expect(
        scaffold({
          appName,
          useTs: true,
          template: 'minimal',
          skipInstall: true,
        }),
      ).rejects.toThrow('copy phase failed');
    } finally {
      copySpy.mockRestore();
    }
  };

  beforeEach(() => {
    // Default: behaves like the real runInstall's skipInstall short-circuit,
    // so every pre-existing test below (all of which pass skipInstall: true)
    // is unaffected by mocking this module. Tests that exercise a failing
    // install override this with mockResolvedValueOnce.
    mockRunInstall.mockImplementation(async (options) =>
      options.skipInstall
        ? { success: true, packageManager: 'skipped' }
        : { success: true, packageManager: 'npm' }
    );
    mockExeca.mockReset();
    mockExeca.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    // restore cwd
    if (origCwd) process.chdir(origCwd);
    // cleanup all temp parents
    await Promise.all(
      tmpParents.map(async (p) => {
        try {
          await fs.remove(p);
        } catch {
          // ignore
        }
      })
    );
    tmpParents.length = 0;
  });

  test('scaffolds minimal template and substitutes placeholders (default values)', async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    const appName = 'My Special App';

    await scaffold({
      appName,
      useTs: true,
      template: 'minimal',
      skipInstall: true,
    });

    const target = path.join(parent, appName);
    expect(await fs.pathExists(target)).toBe(true);

    // README should have app name substituted
    const readme = await fs.readFile(path.join(target, 'README.md'), 'utf8');
    expect(readme).toContain(`# ${appName}`);

    // .env.example should contain default horizon and app name
    const envExample = await fs.readFile(path.join(target, '.env.example'), 'utf8');
    expect(envExample).toContain('NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org');
    expect(envExample).toContain(`NEXT_PUBLIC_APP_NAME=${appName}`);
    expect(envExample).toContain('NEXT_PUBLIC_NETWORK=TESTNET');

    // stellar-wallet-kit should have injected default wallets and NETWORK should be TESTNET
    const kitFile = await fs.readFile(path.join(target, 'src/lib/stellar-wallet-kit.ts'), 'utf8');
    expect(kitFile).toContain(
      'const INJECTED_WALLETS: string[] = ["freighter","albedo","lobstr"];',
    );
  });

  test('injects custom URLs and wallet list and sets NETWORK=PUBLIC when horizon contains public', async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    const appName = 'custom-app';
    const horizon = 'https://horizon-public.stellar.org';
    const soroban = 'https://custom-soroban.example';
    const wallets = ['freighter', 'xbull'];

    await scaffold({
      appName,
      useTs: true,
      template: 'minimal',
      horizonUrl: horizon,
      sorobanUrl: soroban,
      wallets,
      skipInstall: true,
    });

    const target = path.join(parent, appName);
    const envExample = await fs.readFile(path.join(target, '.env.example'), 'utf8');
    expect(envExample).toContain(`NEXT_PUBLIC_HORIZON_URL=${horizon}`);
    expect(envExample).toContain(`NEXT_PUBLIC_SOROBAN_URL=${soroban}`);
    expect(envExample).toContain('NEXT_PUBLIC_NETWORK=PUBLIC');

    const kitFile = await fs.readFile(path.join(target, 'src/lib/stellar-wallet-kit.ts'), 'utf8');
    expect(kitFile).toContain("network: ('PUBLIC' as string) === 'PUBLIC'");
  });

  test('uses the default TypeScript template when no template is provided', async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    const appName = 'default-template-app';

    await scaffold({
      appName,
      useTs: true,
      skipInstall: true,
    });

    const target = path.join(parent, appName);
    expect(await fs.pathExists(path.join(target, 'tsconfig.json'))).toBe(true);

    const packageJson = await fs.readJson(path.join(target, 'package.json'));
    expect(packageJson.name).toBe(appName);
  });

  test('throws when target directory already exists without force and leaves it untouched', async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    const appName = 'already-exists-app';
    const target = path.join(parent, appName);
    await fs.ensureDir(target);
    const existingFile = path.join(target, 'existing.txt');
    await fs.writeFile(existingFile, 'keep this project');

    await expect(
      scaffold({
        appName,
        useTs: true,
        template: 'minimal',
        skipInstall: true,
      })
    ).rejects.toThrow(/already exists/i);

    expect(await fs.readFile(existingFile, 'utf8')).toBe('keep this project');
  });

  test('keeps files outside the target directory after a copy-phase failure', async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    const appName = 'copy-failure-boundary';
    const outsideFile = path.join(parent, 'sibling-data', 'keep.txt');
    await fs.outputFile(outsideFile, 'keep this file');

    await expectCopyPhaseFailure(appName);

    expect(await fs.readFile(outsideFile, 'utf8')).toBe('keep this file');
  });

  test('replaces an existing directory with the default scaffold when force and defaults are enabled', async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    const appName = 'force-overwrite-app';
    const target = path.join(parent, appName);
    const legacyFile = path.join(target, 'legacy.txt');
    await fs.outputFile(legacyFile, 'old project contents');

    await scaffold({
      appName,
      useTs: true,
      force: true,
      defaults: true,
      skipInstall: true,
    });

    expect(await fs.pathExists(target)).toBe(true);
    expect(await fs.pathExists(legacyFile)).toBe(false);
    expect(await fs.readFile(path.join(target, 'README.md'), 'utf8')).toContain(`# ${appName}`);
  });

  test('.git and node_modules are excluded from copy', async () => {
    // Determine template dir the same way scaffold does
    const scaffoldModulePath = path.resolve(__dirname, '../src/lib/scaffold.ts');
    const scaffoldDir = path.dirname(scaffoldModulePath);
    const templateDirCandidate = path.resolve(scaffoldDir, '../../templates/minimal');

    // Create marker files inside the template directory to ensure copy would pick them up if not filtered
    const gitMarker = path.join(templateDirCandidate, '.git', 'MARKER');
    const nodeMarker = path.join(templateDirCandidate, 'node_modules', 'MARKER');

    try {
      await fs.ensureDir(path.dirname(gitMarker));
      await fs.ensureDir(path.dirname(nodeMarker));
      await fs.writeFile(gitMarker, 'git');
      await fs.writeFile(nodeMarker, 'node');

      origCwd = process.cwd();
      const parent = await makeTempParent();
      process.chdir(parent);

      const appName = 'exclude-check';
      await scaffold({
        appName,
        useTs: true,
        template: 'minimal',
        skipInstall: true,
      });

      const targetGit = path.join(parent, appName, '.git', 'MARKER');
      const targetNode = path.join(parent, appName, 'node_modules', 'MARKER');

      expect(await fs.pathExists(targetGit)).toBe(false);
      expect(await fs.pathExists(targetNode)).toBe(false);
    } finally {
      // clean up markers from template dir
      try {
        await fs.remove(path.join(templateDirCandidate, '.git'));
      } catch {}
      try {
        await fs.remove(path.join(templateDirCandidate, 'node_modules'));
      } catch {}
    }
  });

  // -------------------------------------------------------------------------
  // #896 — control whether a git repo is initialized in the new project.
  // -------------------------------------------------------------------------
  describe('git init behavior (#896)', () => {
    test('runs `git init` in the new project by default', async () => {
      origCwd = process.cwd();
      const parent = await makeTempParent();
      process.chdir(parent);

      const appName = 'git-default-app';
      await scaffold({
        appName,
        useTs: true,
        template: 'minimal',
        skipInstall: true,
      });

      const target = path.join(parent, appName);
      expect(mockExeca).toHaveBeenCalledWith('git', ['init'], {
        cwd: target,
        stdio: 'ignore',
      });
    });

    test('skips `git init` when git: false is passed', async () => {
      origCwd = process.cwd();
      const parent = await makeTempParent();
      process.chdir(parent);

      const appName = 'git-disabled-app';
      await scaffold({
        appName,
        useTs: true,
        template: 'minimal',
        skipInstall: true,
        git: false,
      });

      expect(mockExeca).not.toHaveBeenCalled();
    });

    test('continues scaffolding even when `git init` fails', async () => {
      mockExeca.mockRejectedValueOnce(new Error('git not found'));
      origCwd = process.cwd();
      const parent = await makeTempParent();
      process.chdir(parent);

      const appName = 'git-fails-app';
      await scaffold({
        appName,
        useTs: true,
        template: 'minimal',
        skipInstall: true,
      });

      const target = path.join(parent, appName);
      expect(await fs.pathExists(path.join(target, 'package.json'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // #895 — pass the selected package manager through to install.
  // -------------------------------------------------------------------------
  describe('package manager flag (#895)', () => {
    test('passes the selected package manager to runInstall', async () => {
      mockRunInstall.mockResolvedValueOnce({
        success: true,
        packageManager: 'bun',
      });

      origCwd = process.cwd();
      const parent = await makeTempParent();
      process.chdir(parent);

      const appName = 'pm-flag-app';
      await scaffold({
        appName,
        useTs: true,
        template: 'minimal',
        skipInstall: false,
        packageManager: 'bun',
      });

      expect(mockRunInstall).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: path.join(parent, appName), packageManager: 'bun' }),
      );
    });

    test('defaults to npm detection when no package manager is passed', async () => {
      origCwd = process.cwd();
      const parent = await makeTempParent();
      process.chdir(parent);

      const appName = 'pm-default-app';
      await scaffold({
        appName,
        useTs: true,
        template: 'minimal',
        skipInstall: false,
      });

      expect(mockRunInstall).toHaveBeenCalledWith(
        expect.objectContaining({ packageManager: undefined }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // #680 — regression: no unresolved {{PLACEHOLDER}} tokens in scaffolded
  // output, and no dead (unused) placeholders in the scaffold config map.
  // -------------------------------------------------------------------------
  describe('placeholder token hygiene (#680)', () => {
    // The token pattern that scaffold.ts uses: {{ followed by one or more
    // uppercase letters/underscores, followed by }}.
    const TOKEN_REGEX = /\{\{[A-Z_]+\}\}/g;

    // All template variants that scaffold() supports (useTs + template name
    // combinations that map to a real template directory).
    const TEMPLATE_VARIANTS: Array<{ useTs: boolean; template: string }> = [
      { useTs: true,  template: 'default'  },
      { useTs: true,  template: 'defi'     },
      { useTs: true,  template: 'minimal'  },
      { useTs: false, template: 'default'  }, // → js-template
      { useTs: false, template: 'defi'     }, // → js-defi
    ];

    // The --with-contracts overlay is copied over the chosen template and then
    // rewrites package.json and .env.example, so it needs its own variants: a
    // token left unresolved on that path never shows up in the plain variants
    // above (#827).
    const CONTRACTS_VARIANTS: Array<{ useTs: boolean; template: string }> = [
      { useTs: true,  template: 'default'  },
      { useTs: true,  template: 'defi'     },
      { useTs: true,  template: 'minimal'  },
      { useTs: false, template: 'default'  }, // → js-template
      { useTs: false, template: 'defi'     }, // → js-defi
    ];

    /**
     * Recursively collect all regular files under `dir`, skipping
     * node_modules and .git which are never scaffolded anyway.
     */
    async function collectFiles(dir: string): Promise<string[]> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const results: string[] = [];
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...(await collectFiles(full)));
        } else {
          results.push(full);
        }
      }
      return results;
    }

    test.each(TEMPLATE_VARIANTS)(
      'no unresolved {{…}} tokens in scaffolded output: useTs=$useTs template=$template',
      async ({ useTs, template }) => {
        origCwd = process.cwd();
        const parent = await makeTempParent('nextellar-ph-test-');
        process.chdir(parent);

        const appName = `ph-check-${template}-${useTs ? 'ts' : 'js'}`;

        await scaffold({
          appName,
          useTs,
          template,
          skipInstall: true,
        });

        const targetDir = path.join(parent, appName);
        const files = await collectFiles(targetDir);

        // Collect every unresolved token across every scaffolded file.
        const violations: Array<{ file: string; token: string }> = [];

        for (const file of files) {
          // Only inspect text-like files; skip binary/lock files that are
          // never processed by scaffold's replaceInFile anyway.
          const ext = path.extname(file).toLowerCase();
          const binaryExts = new Set([
            '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
            '.woff', '.woff2', '.ttf', '.eot', '.otf',
            '.zip', '.tar', '.gz',
          ]);
          if (binaryExts.has(ext)) continue;

          let content: string;
          try {
            content = await fs.readFile(file, 'utf8');
          } catch {
            // Unreadable as text — skip.
            continue;
          }

          const matches = content.match(TOKEN_REGEX);
          if (matches) {
            const relPath = path.relative(targetDir, file);
            for (const token of [...new Set(matches)]) {
              violations.push({ file: relPath, token });
            }
          }
        }

        if (violations.length > 0) {
          const detail = violations
            .map(({ file, token }) => `  ${token}  in  ${file}`)
            .join('\n');
          throw new Error(
            `Unresolved placeholder tokens found after scaffolding ` +
            `"${template}" (useTs=${useTs}):\n${detail}`,
          );
        }
      },
    );

    /** Scan a scaffolded app and return every unresolved {{TOKEN}} found. */
    async function findUnresolvedTokens(
      targetDir: string,
    ): Promise<Array<{ file: string; token: string }>> {
      const files = await collectFiles(targetDir);
      const violations: Array<{ file: string; token: string }> = [];

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        const binaryExts = new Set([
          '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
          '.woff', '.woff2', '.ttf', '.eot', '.otf',
          '.zip', '.tar', '.gz',
        ]);
        if (binaryExts.has(ext)) continue;

        let content: string;
        try {
          content = await fs.readFile(file, 'utf8');
        } catch {
          continue;
        }

        const matches = content.match(TOKEN_REGEX);
        if (matches) {
          const relPath = path.relative(targetDir, file);
          for (const token of [...new Set(matches)]) {
            violations.push({ file: relPath, token });
          }
        }
      }

      return violations;
    }

    test.each(CONTRACTS_VARIANTS)(
      'no unresolved {{…}} tokens with --with-contracts: useTs=$useTs template=$template',
      async ({ useTs, template }) => {
        origCwd = process.cwd();
        const parent = await makeTempParent('nextellar-contracts-ph-');
        process.chdir(parent);

        const appName = `contracts-ph-${template}-${useTs ? 'ts' : 'js'}`;

        await scaffold({
          appName,
          useTs,
          template,
          withContracts: true,
          skipInstall: true,
        });

        const targetDir = path.join(parent, appName);
        const violations = await findUnresolvedTokens(targetDir);

        if (violations.length > 0) {
          const detail = violations
            .map(({ file, token }) => `  ${token}  in  ${file}`)
            .join('\n');
          throw new Error(
            `Unresolved placeholder tokens found after scaffolding ` +
            `"${template}" with --with-contracts (useTs=${useTs}):\n${detail}`,
          );
        }
      },
    );

    test.each(CONTRACTS_VARIANTS)(
      'contracts overlay files are present and consistent: useTs=$useTs template=$template',
      async ({ useTs, template }) => {
        origCwd = process.cwd();
        const parent = await makeTempParent('nextellar-contracts-files-');
        process.chdir(parent);

        const appName = `contracts-files-${template}-${useTs ? 'ts' : 'js'}`;

        await scaffold({
          appName,
          useTs,
          template,
          withContracts: true,
          skipInstall: true,
        });

        const targetDir = path.join(parent, appName);

        // The Rust workspace and both sample contracts come across.
        for (const rel of [
          'contracts/Cargo.toml',
          'contracts/hello_world/Cargo.toml',
          'contracts/hello_world/src/lib.rs',
          'contracts/counter/Cargo.toml',
          'contracts/counter/src/lib.rs',
          'SOROBAN_SETUP.md',
        ]) {
          expect(await fs.pathExists(path.join(targetDir, rel))).toBe(true);
        }

        // …along with the TS client bindings the app imports.
        for (const rel of [
          'src/lib/contracts/index.ts',
          'src/lib/bindings/HelloWorld.ts',
          'src/lib/bindings/Counter.ts',
        ]) {
          expect(await fs.pathExists(path.join(targetDir, rel))).toBe(true);
        }

        // The overlay adds the contract scripts alongside the template's own
        // rather than replacing them, so the app is still buildable.
        const pkgJson = await fs.readJson(path.join(targetDir, 'package.json'));
        expect(pkgJson.name).toBe(appName);
        expect(pkgJson.scripts).toMatchObject({
          'contracts:build': 'cd contracts && stellar contract build',
          'contracts:test': 'cd contracts && cargo test',
        });
        expect(pkgJson.scripts.build).toBe('next build');

        // The contract ID env var is documented, and the placeholder it points
        // at is the one src/lib/contracts validates against.
        const envExample = await fs.readFile(
          path.join(targetDir, '.env.example'),
          'utf8',
        );
        expect(envExample).toContain(
          'NEXT_PUBLIC_HELLO_WORLD_CONTRACT_ID=C_REPLACE_WITH_YOUR_CONTRACT_ID',
        );

        const contractsIndex = await fs.readFile(
          path.join(targetDir, 'src/lib/contracts/index.ts'),
          'utf8',
        );
        expect(contractsIndex).toContain('NEXT_PUBLIC_HELLO_WORLD_CONTRACT_ID');
      },
    );

    test('scaffolding without --with-contracts leaves no contracts overlay behind', async () => {
      origCwd = process.cwd();
      const parent = await makeTempParent('nextellar-no-contracts-');
      process.chdir(parent);

      const appName = 'no-contracts-app';

      await scaffold({
        appName,
        useTs: true,
        template: 'defi',
        skipInstall: true,
      });

      const targetDir = path.join(parent, appName);

      expect(await fs.pathExists(path.join(targetDir, 'contracts'))).toBe(false);
      expect(
        await fs.pathExists(path.join(targetDir, 'SOROBAN_SETUP.md')),
      ).toBe(false);

      const pkgJson = await fs.readJson(path.join(targetDir, 'package.json'));
      expect(pkgJson.scripts['contracts:build']).toBeUndefined();
      expect(pkgJson.scripts['contracts:test']).toBeUndefined();
    });

    test('every token in scaffold.ts config map appears in at least one template source file', async () => {
      // Read scaffold.ts source and extract all {{TOKEN}} keys from the
      // `config` object literal.  We do this via a simple regex over the
      // source text rather than importing the module, so we never actually
      // run scaffold here — this is a pure static analysis check.
      const scaffoldSrc = await fs.readFile(
        path.resolve(__dirname, '../src/lib/scaffold.ts'),
        'utf8',
      );

      // Match every "{{TOKEN}}" string literal that appears as a key in the
      // config object (they always appear quoted inside the source).
      const keyMatches = scaffoldSrc.match(/"(\{\{[A-Z_]+\}\})"/g) ?? [];
      const configTokens = [
        ...new Set(keyMatches.map((m) => m.replace(/"/g, ''))),
      ];

      expect(configTokens.length).toBeGreaterThan(0); // sanity: we found the config

      // Collect all source files from every template directory.
      const templatesRoot = path.resolve(__dirname, '../src/templates');
      const templateDirs = await fs.readdir(templatesRoot);

      // Read all template source files into a single concatenated string for
      // fast multi-token membership checks.
      let allTemplateSrc = '';
      for (const dir of templateDirs) {
        const fullDir = path.join(templatesRoot, dir);
        const stat = await fs.stat(fullDir);
        if (!stat.isDirectory()) continue;
        const files = await collectFiles(fullDir);
        for (const file of files) {
          const ext = path.extname(file).toLowerCase();
          const binaryExts = new Set([
            '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
            '.woff', '.woff2', '.ttf', '.eot', '.otf',
            '.zip', '.tar', '.gz',
          ]);
          if (binaryExts.has(ext)) continue;
          try {
            allTemplateSrc += await fs.readFile(file, 'utf8');
          } catch {
            // skip unreadable
          }
        }
      }

      // Every token in the config map MUST appear at least once in the
      // template source files.  If it doesn't, it's a dead placeholder that
      // will never be substituted and should be removed from scaffold.ts.
      const deadTokens = configTokens.filter(
        (token) => !allTemplateSrc.includes(token),
      );

      if (deadTokens.length > 0) {
        throw new Error(
          `Dead placeholder(s) found in scaffold.ts config — ` +
          `defined but never used in any template file:\n` +
          deadTokens.map((t) => `  ${t}`).join('\n') +
          `\n\nEither add the token to the relevant template file(s) or ` +
          `remove it from the config map in src/lib/scaffold.ts.`,
        );
      }
    });
  });

  // #673 — an install-only failure must leave the scaffolded project
  // directory intact and tell the user exactly what to run, instead of
  // deleting the directory it just told them to run a command inside.
  describe('install failure handling (#673)', () => {
    test('keeps the project directory and prints the manual install command when only install fails', async () => {
      mockRunInstall.mockResolvedValueOnce({
        success: false,
        packageManager: 'npm',
        error: 'Some non-network install error',
      });

      origCwd = process.cwd();
      const parent = await makeTempParent();
      process.chdir(parent);

      const appName = 'install-fails-app';

      await expect(
        scaffold({ appName, useTs: true, template: 'minimal', skipInstall: false })
      ).rejects.toThrow(/cd install-fails-app[\s\S]*npm install/);

      // The directory (and its scaffolded files) must still be there —
      // deleting it would make "run install manually" impossible.
      const target = path.join(parent, appName);
      expect(await fs.pathExists(target)).toBe(true);
      expect(await fs.pathExists(path.join(target, 'package.json'))).toBe(true);
    });

    test('still cleans up fully when the failure happens during the copy phase, before any files are usable', async () => {
      origCwd = process.cwd();
      const parent = await makeTempParent();
      process.chdir(parent);

      const appName = 'copy-fails-app';
      const target = path.join(parent, appName);

      const copySpy = jest.spyOn(fs, 'copy').mockRejectedValueOnce(new Error('disk full'));

      try {
        await expect(
          scaffold({ appName, useTs: true, template: 'minimal', skipInstall: true })
        ).rejects.toThrow('disk full');

        // fs.copy never completed, so nothing worth keeping was ever
        // written — full cleanup is correct here, unlike the install-only
        // failure case above.
        expect(await fs.pathExists(target)).toBe(false);
      } finally {
        copySpy.mockRestore();
      }
    });

  });
});
