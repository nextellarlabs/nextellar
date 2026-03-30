import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('nextellar CLI', () => {
  const tmpDir = path.join(__dirname, 'tmp-test-app');

  beforeEach(async () => {
    await fs.remove(tmpDir);
  }, 10000);

  it('should scaffold a new project and exit cleanly', async () => {
    const { exitCode, stdout } = await execa('node', [
      path.resolve(__dirname, '../dist/bin/nextellar.js'),
      tmpDir,
      '--typescript',
      '--defaults',
      '--skip-install'
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('✅ Your Nextellar app is ready!');
    expect(await fs.pathExists(tmpDir)).toBe(true);
  }, 30000);
});