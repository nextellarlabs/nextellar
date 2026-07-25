import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { upgrade } from '../src/lib/upgrade.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATES = path.resolve(__dirname, '../src/templates');
const templateFile = (template: string, rel: string) =>
  path.join(TEMPLATES, template, 'src', rel);

jest.setTimeout(30000);

/** Files the minimal template ships under src/hooks and src/lib. */
const MINIMAL_MANAGED = [
  'hooks/useStellarBalances.ts',
  'hooks/useStellarWallet.ts',
  'lib/stellar-wallet-kit.ts',
  'lib/storage.ts',
];

/** Files a user owns that upgrade must never touch. */
const UNMANAGED = {
  'src/app/page.tsx': '// my page\n',
  'src/components/WalletConnectButton.tsx': '// my button\n',
  'src/contexts/WalletProvider.tsx': '// my provider\n',
};

describe('upgrade', () => {
  const tmpDirs: string[] = [];
  let origCwd: string;
  let logSpy: jest.SpyInstance;

  const read = (file: string) => fs.readFile(file, 'utf8');
  const output = () => logSpy.mock.calls.map((c) => c.join(' ')).join('\n');

  /**
   * Project fixture: .nextellar marker, a package.json whose Stellar deps match
   * the template (so only file changes show up), the template's managed files,
   * and a few user-owned files outside src/hooks|src/lib.
   */
  const makeProject = async (opts: {
    template?: string;
    managed?: string[];
    overrides?: Record<string, string>;
  } = {}) => {
    const { template = 'minimal', managed = MINIMAL_MANAGED, overrides = {} } = opts;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextellar-upgrade-'));
    tmpDirs.push(dir);

    await fs.outputJson(path.join(dir, '.nextellar/config.json'), {
      template,
      nextellarVersion: '1.0.0',
    });

    const tplPkg = await fs.readJson(path.join(TEMPLATES, template, 'package.json'));
    await fs.writeJson(path.join(dir, 'package.json'), {
      name: 'demo',
      dependencies: { ...tplPkg.dependencies },
      devDependencies: { ...tplPkg.devDependencies },
    });

    for (const rel of managed) {
      const dest = path.join(dir, 'src', rel);
      await fs.ensureDir(path.dirname(dest));
      await fs.copyFile(templateFile(template, rel), dest);
    }
    for (const [rel, content] of Object.entries(overrides)) {
      await fs.outputFile(path.join(dir, rel), content);
    }
    for (const [rel, content] of Object.entries(UNMANAGED)) {
      await fs.outputFile(path.join(dir, rel), content);
    }

    return dir;
  };

  beforeEach(() => {
    origCwd = process.cwd();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(origCwd);
    logSpy.mockRestore();
    await Promise.all(tmpDirs.map((d) => fs.remove(d).catch(() => {})));
    tmpDirs.length = 0;
  });

  it('errors when .nextellar/config.json is missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextellar-upgrade-'));
    tmpDirs.push(dir);
    await fs.writeJson(path.join(dir, 'package.json'), { name: 'demo' });
    process.chdir(dir);

    await expect(upgrade({ yes: true })).rejects.toThrow(
      /Not a Nextellar project/
    );
  });

  it('resolves the template named in .nextellar/config.json', async () => {
    const minimal = await makeProject({ template: 'minimal', managed: [] });
    process.chdir(minimal);
    await upgrade({ dryRun: true });
    const minimalOut = output();

    expect(minimalOut).toMatch(/Project template:\s*\S*minimal/);
    expect(minimalOut).toContain('hooks/useStellarWallet.ts');
    expect(minimalOut).toContain('lib/storage.ts');
    // Not part of the minimal template.
    expect(minimalOut).not.toContain('hooks/useTrustlines.ts');

    logSpy.mockClear();
    process.chdir(origCwd);

    const defi = await makeProject({ template: 'defi', managed: [] });
    process.chdir(defi);
    await upgrade({ dryRun: true });
    const defiOut = output();

    expect(defiOut).toMatch(/Project template:\s*\S*defi/);
    // Only the defi template ships these two.
    expect(defiOut).toContain('hooks/useTrustlines.ts');
    expect(defiOut).toContain('hooks/useOfferBook.ts');
    expect(defiOut).not.toContain('lib/storage.ts');
  });

  it('reports an up-to-date project when every managed file is identical', async () => {
    const dir = await makeProject();
    process.chdir(dir);

    await upgrade({ yes: true });

    expect(output()).toContain('No template updates to apply.');
    expect(await fs.pathExists(path.join(dir, '.nextellar/backups'))).toBe(false);
  });

  it('updates only the files that differ from the template', async () => {
    const dir = await makeProject({
      overrides: { 'src/hooks/useStellarBalances.ts': '// stale copy\n' },
    });
    process.chdir(dir);

    await upgrade({ yes: true });

    const logged = output();
    expect(logged).toContain('hooks/useStellarBalances.ts');
    expect(logged).not.toContain('hooks/useStellarWallet.ts');

    expect(await read(path.join(dir, 'src/hooks/useStellarBalances.ts'))).toBe(
      await read(templateFile('minimal', 'hooks/useStellarBalances.ts'))
    );
    // The stale copy is backed up before being overwritten.
    const backups = await fs.readdir(path.join(dir, '.nextellar/backups'));
    expect(backups).toHaveLength(1);
    expect(
      await read(
        path.join(
          dir,
          '.nextellar/backups',
          backups[0],
          'src/hooks/useStellarBalances.ts'
        )
      )
    ).toBe('// stale copy\n');
  });

  it('only considers files under src/hooks and src/lib', async () => {
    const dir = await makeProject({
      overrides: { 'src/hooks/useStellarBalances.ts': '// stale copy\n' },
    });
    process.chdir(dir);

    await upgrade({ yes: true });

    const logged = output();
    for (const rel of Object.keys(UNMANAGED)) {
      // Neither listed as a change...
      expect(logged).not.toContain(rel.replace('src/', ''));
      // ...nor rewritten on disk.
      expect(await read(path.join(dir, rel))).toBe(
        UNMANAGED[rel as keyof typeof UNMANAGED]
      );
    }
  });

  it('writes nothing when --dry-run is passed', async () => {
    const dir = await makeProject({
      overrides: { 'src/hooks/useStellarBalances.ts': '// stale copy\n' },
    });
    process.chdir(dir);

    await upgrade({ dryRun: true });

    expect(output()).toContain('no files were modified');
    expect(await read(path.join(dir, 'src/hooks/useStellarBalances.ts'))).toBe(
      '// stale copy\n'
    );
    expect(await fs.pathExists(path.join(dir, '.nextellar/backups'))).toBe(false);
  });

  it('records the CLI version in .nextellar/config.json after upgrading', async () => {
    const dir = await makeProject({
      overrides: { 'src/hooks/useStellarBalances.ts': '// stale copy\n' },
    });
    process.chdir(dir);

    await upgrade({ yes: true });

    const config = await fs.readJson(path.join(dir, '.nextellar/config.json'));
    expect(config.template).toBe('minimal');
    expect(config.updatedAt).toEqual(expect.any(String));
  });
});
