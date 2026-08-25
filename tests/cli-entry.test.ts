import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const cli = path.resolve(__dirname, '../dist/bin/nextellar.js');
const tmpDir = path.join(__dirname, 'tmp-test-app');

describe('nextellar CLI', () => {
  beforeEach(async () => {
    await fs.remove(tmpDir);
  }, 10000);

  it('should scaffold a new project and exit cleanly', async () => {
    const { exitCode, stdout } = await execa('node', [
      cli,
      tmpDir,
      '--typescript',
      '--defaults',
      '--skip-install'
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('✔ Nextellar scaffold complete!');
    expect(await fs.pathExists(tmpDir)).toBe(true);
  }, 30000);

  it('should fail fast on --javascript --template minimal before banner and prompts', async () => {
    const { exitCode, stderr, stdout } = await execa('node', [
      cli,
      tmpDir,
      '--javascript',
      '--template',
      'minimal',
      '--defaults'
    ], { reject: false });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('--javascript');
    expect(stderr).toContain('default template');
    // Should fail before banner clears console
    expect(stdout).not.toContain('Nextellar CLI');
    expect(stdout).not.toContain('Nextellar scaffold complete');
    expect(await fs.pathExists(tmpDir)).toBe(false);
  }, 30000);

  it('should fail fast on --javascript --template defi before banner and prompts', async () => {
    const { exitCode, stderr, stdout } = await execa('node', [
      cli,
      tmpDir,
      '--javascript',
      '--template',
      'defi',
      '--defaults'
    ], { reject: false });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('--javascript');
    expect(stderr).toContain('default template');
    // Should fail before banner clears console
    expect(stdout).not.toContain('Nextellar CLI');
    expect(stdout).not.toContain('Nextellar scaffold complete');
    expect(await fs.pathExists(tmpDir)).toBe(false);
  }, 30000);

  describe('clean (#904)', () => {
    it('removes .nextellar/build and exits cleanly', async () => {
      const buildDir = path.join(tmpDir, '.nextellar', 'build');
      await fs.outputFile(path.join(buildDir, 'artifact.txt'), 'stale build output');

      const { exitCode, stdout } = await execa('node', [cli, 'clean'], { cwd: tmpDir });

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Removed .nextellar/build');
      expect(await fs.pathExists(buildDir)).toBe(false);
    }, 15000);

    it('exits cleanly (no error) when .nextellar/build does not exist', async () => {
      await fs.ensureDir(tmpDir);

      const { exitCode, stdout } = await execa('node', [cli, 'clean'], { cwd: tmpDir });

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Nothing to clean');
    }, 15000);
  });
});
