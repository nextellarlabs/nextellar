import { readFile } from 'node:fs/promises';

describe('routes-d documentation', () => {
  it('documents deployment operations and rollback paths', async () => {
    const doc = await readFile('routes-d/docs/deployment.md', 'utf8');

    expect(doc).toContain('Environment variables');
    expect(doc).toContain('Secrets');
    expect(doc).toContain('External dependencies');
    expect(doc).toContain('Canary rollout');
    expect(doc).toContain('Rollback');
    expect(doc).toContain('On-call escalation');
  });

  it('documents cursor format and profiling workflow', async () => {
    await expect(readFile('routes-d/docs/pagination.md', 'utf8')).resolves.toContain('v1.<payload>.<signature>');
    await expect(readFile('routes-d/docs/profiling.md', 'utf8')).resolves.toContain(
      'routes-d/tests/artifacts/auth-hot-path.cpuprofile',
    );
  });
});
