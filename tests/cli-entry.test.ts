import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('nextellar CLI', () => {
  const tmpDir = path.join(__dirname, 'tmp-test-app');
  const cliDistPath = path.resolve(__dirname, '../dist/bin/nextellar.js');
  const hasBuildArtifacts = fs.existsSync(path.resolve(__dirname, '../dist/src/lib/install.js'));
  const hasCliRuntimeDeps = fs.existsSync(path.resolve(__dirname, '../node_modules/@clack/prompts'));

  beforeEach(async () => {
    await fs.remove(tmpDir);
  }, 10000);

  (hasBuildArtifacts && hasCliRuntimeDeps ? it : it.skip)('should scaffold a new project and exit cleanly', async () => {
    const { exitCode, stdout } = await execa('node', [
      cliDistPath,
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
