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
        } catch (e) {
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
      'const INJECTED_WALLETS: string[] = ["freighter", "albedo", "lobstr"];',
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
