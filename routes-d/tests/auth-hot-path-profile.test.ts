import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authProfileArtifactPath, runAuthHotPathProfile } from './bench/auth-hot-path-profile.js';

describe('routes-d auth hot-path profile harness', () => {
  it('uses a stable artifact path', () => {
    expect(authProfileArtifactPath.replaceAll('\\', '/')).toContain(
      'routes-d/tests/artifacts/auth-hot-path.cpuprofile',
    );
  });

  it('emits a CPU profile artifact for login and refresh load', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'routes-d-profile-'));
    const outputPath = join(outputDir, 'auth-hot-path.cpuprofile');
    const result = await runAuthHotPathProfile({ users: 2, refreshesPerUser: 2, outputPath });
    const profile = JSON.parse(await readFile(outputPath, 'utf8'));

    expect(result).toEqual({ artifactPath: outputPath, loginCount: 2, refreshCount: 4 });
    expect(Array.isArray(profile.nodes)).toBe(true);
  });
});
