import { execSync } from 'child_process';
import fs from 'fs-extra';
import path from 'path';

describe('template comparison documentation', () => {
  const root = path.resolve(__dirname, '..');
  const docPath = path.join(root, 'docs', 'template-comparison.md');

  test('docs/template-comparison.md exists and is non-empty', async () => {
    expect(await fs.pathExists(docPath)).toBe(true);
    const content = await fs.readFile(docPath, 'utf-8');
    expect(content.length).toBeGreaterThan(100);
    expect(content).toContain('Template Comparison Matrix');
    expect(content).toContain('Components Matrix');
    expect(content).toContain('Hooks Matrix');
    expect(content).toContain('Feature Comparison');
  });

  test('generate-template-comparison.mjs --check passes with zero drift', () => {
    expect(() => {
      execSync('node scripts/generate-template-comparison.mjs --check', {
        cwd: root,
        stdio: 'pipe',
      });
    }).not.toThrow();
  });

  test('all 4 core templates (minimal, default, defi, full) are covered', async () => {
    const content = await fs.readFile(docPath, 'utf-8');
    expect(content).toContain('`minimal`');
    expect(content).toContain('`default`');
    expect(content).toContain('`defi`');
    expect(content).toContain('`full`');
  });
});
