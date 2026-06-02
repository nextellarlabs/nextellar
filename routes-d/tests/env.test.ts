import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Variables that appear only in benchmark / profiling helper scripts and are
// not part of the runtime contract; they don't need to be in env.md.
const BENCH_ONLY = new Set([
  'ROUTES_D_BENCH_LOOKUPS',
  'ROUTES_D_BENCH_P',
  'ROUTES_D_BENCH_PAYMENTS',
  'ROUTES_D_BENCH_SEED',
  'ROUTES_D_PROFILE_OUTPUT',
  'ROUTES_D_PROFILE_REFRESHES',
  'ROUTES_D_PROFILE_USERS',
]);

async function collectEnvVars(dir: string): Promise<Set<string>> {
  const vars = new Set<string>();

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        // Skip test files — bench/profile helpers live here and carry vars
        // that are intentionally excluded from env.md.
        if (entry.name === 'tests' || entry.name === 'node_modules' || entry.name === 'dist') {
          continue;
        }
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        const content = await readFile(fullPath, 'utf8');
        for (const m of content.matchAll(/process\.env\.([A-Z_]+)/g)) {
          if (m[1]) vars.add(m[1]);
        }
      }
    }
  }

  await walk(dir);
  return vars;
}

describe('routes-d env documentation (#340)', () => {
  const root = 'routes-d';

  it('env.md exists and contains required sections', async () => {
    const doc = await readFile(`${root}/docs/env.md`, 'utf8');
    expect(doc).toContain('HORIZON_URL');
    expect(doc).toContain('SOROBAN_RPC_URL');
    expect(doc).toContain('ALLOWED_ORIGINS');
    expect(doc).toContain('NODE_ENV');
    expect(doc).toContain('Secret');
  });

  it('.env.example exists and documents key variables', async () => {
    const example = await readFile(`${root}/.env.example`, 'utf8');
    expect(example).toContain('HORIZON_URL');
    expect(example).toContain('SOROBAN_RPC_URL');
    expect(example).toContain('ALLOWED_ORIGINS');
    expect(example).toContain('NODE_ENV');
  });

  it('env.md documents every env variable read in non-test source files', async () => {
    const envMd = await readFile(`${root}/docs/env.md`, 'utf8');
    const codeVars = await collectEnvVars(root);

    const undocumented: string[] = [];
    for (const varName of codeVars) {
      if (BENCH_ONLY.has(varName)) continue;
      if (!envMd.includes(varName)) undocumented.push(varName);
    }

    if (undocumented.length > 0) {
      throw new Error(
        `The following env vars are used in source code but missing from env.md:\n${undocumented.map((v) => `  - ${v}`).join('\n')}`,
      );
    }
  });

  it('.env.example and env.md are consistent — all .env.example vars appear in env.md', async () => {
    const envMd = await readFile(`${root}/docs/env.md`, 'utf8');
    const example = await readFile(`${root}/.env.example`, 'utf8');

    const exampleVars = [...example.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]!);
    const missing = exampleVars.filter((v) => !envMd.includes(v));

    if (missing.length > 0) {
      throw new Error(
        `.env.example declares vars absent from env.md:\n${missing.map((v) => `  - ${v}`).join('\n')}`,
      );
    }
  });
});
