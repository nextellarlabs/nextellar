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

  test('throws when target directory already exists', async () => {
    origCwd = process.cwd();
    const parent = await makeTempParent();
    process.chdir(parent);

    const appName = 'already-exists-app';
    const target = path.join(parent, appName);
    await fs.ensureDir(target);

    await expect(
      scaffold({
        appName,
        useTs: true,
        template: 'minimal',
        skipInstall: true,
      })
    ).rejects.toThrow(/already exists/i);
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
      } catch (_) {}
      try {
        await fs.remove(path.join(templateDirCandidate, 'node_modules'));
      } catch (_) {}
    }
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
