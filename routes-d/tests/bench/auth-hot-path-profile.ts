import { mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { Session } from 'node:inspector/promises';

export interface AuthProfileOptions {
  users?: number;
  refreshesPerUser?: number;
  outputPath?: string;
}

export interface AuthProfileResult {
  artifactPath: string;
  loginCount: number;
  refreshCount: number;
}

export const authProfileArtifactPath = resolve('routes-d/tests/artifacts/auth-hot-path.cpuprofile');

export async function runAuthHotPathProfile(options: AuthProfileOptions = {}): Promise<AuthProfileResult> {
  const users = options.users ?? 25;
  const refreshesPerUser = options.refreshesPerUser ?? 4;
  const artifactPath = options.outputPath ?? authProfileArtifactPath;
  const session = new Session();

  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.start');

  let loginCount = 0;
  let refreshCount = 0;
  for (let userIndex = 0; userIndex < users; userIndex += 1) {
    const token = simulateLogin(`user-${userIndex}`);
    loginCount += 1;

    for (let refreshIndex = 0; refreshIndex < refreshesPerUser; refreshIndex += 1) {
      simulateRefresh(token, refreshIndex);
      refreshCount += 1;
    }
  }

  const { profile } = await session.post('Profiler.stop');
  session.disconnect();

  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, JSON.stringify(profile, null, 2));

  return { artifactPath, loginCount, refreshCount };
}

function simulateLogin(userId: string): string {
  const nonce = randomBytes(16).toString('hex');
  return createHash('sha256').update(`${userId}:${nonce}:login`).digest('hex');
}

function simulateRefresh(token: string, iteration: number): string {
  return createHash('sha256').update(`${token}:${iteration}:refresh`).digest('hex');
}

if (process.argv[1]?.endsWith('auth-hot-path-profile.ts')) {
  runAuthHotPathProfile({
    users: Number(process.env.ROUTES_D_PROFILE_USERS ?? 50),
    refreshesPerUser: Number(process.env.ROUTES_D_PROFILE_REFRESHES ?? 5),
    outputPath: process.env.ROUTES_D_PROFILE_OUTPUT,
  }).then((result) => {
    console.log(JSON.stringify(result, null, 2));
  });
}
