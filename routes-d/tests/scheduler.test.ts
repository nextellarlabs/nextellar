import {
  registerJob,
  runJob,
  getJob,
  clearJobs,
  schedulerDeps,
} from '../lib/scheduler.js';

beforeEach(() => {
  clearJobs();
  schedulerDeps.loadLastRunAt = jest.fn().mockResolvedValue(null);
  schedulerDeps.saveLastRunAt = jest.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  clearJobs();
});

describe('registerJob', () => {
  it('registers a job and stores the record', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    await registerJob('cleanup', 60_000, fn);

    const record = getJob('cleanup');
    expect(record).toBeDefined();
    expect(record!.name).toBe('cleanup');
    expect(record!.intervalMs).toBe(60_000);
  });

  it('loads lastRunAt from persistence on registration', async () => {
    const savedTs = Date.now() - 5_000;
    (schedulerDeps.loadLastRunAt as jest.Mock).mockResolvedValue(savedTs);

    const fn = jest.fn().mockResolvedValue(undefined);
    await registerJob('report', 60_000, fn);

    expect(getJob('report')!.lastRunAt).toBe(savedTs);
    expect(schedulerDeps.loadLastRunAt).toHaveBeenCalledWith('report');
  });

  it('does not register the same job twice', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    await registerJob('dedupe', 60_000, fn);
    await registerJob('dedupe', 30_000, fn);

    expect(getJob('dedupe')!.intervalMs).toBe(60_000);
  });
});

describe('runJob', () => {
  it('executes the job function and updates lastRunAt', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    const before = Date.now();
    await registerJob('task', 60_000, fn);
    await runJob('task');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(getJob('task')!.lastRunAt).toBeGreaterThanOrEqual(before);
  });

  it('persists lastRunAt after a successful run', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    await registerJob('persist-test', 60_000, fn);
    await runJob('persist-test');

    expect(schedulerDeps.saveLastRunAt).toHaveBeenCalledWith(
      'persist-test',
      expect.any(Number),
    );
  });

  it('does nothing for an unknown job name', async () => {
    await expect(runJob('nonexistent')).resolves.toBeUndefined();
  });
});

describe('skip-overlap', () => {
  it('skips a second run if the previous instance is still active', async () => {
    let resolveFirst!: () => void;
    const first = new Promise<void>((res) => {
      resolveFirst = res;
    });

    const fn = jest.fn().mockReturnValue(first);
    await registerJob('overlap', 60_000, fn);

    const run1 = runJob('overlap');
    const run2 = runJob('overlap');

    resolveFirst();
    await run1;
    await run2;

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('allows a new run after the previous one completes', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    await registerJob('sequential', 60_000, fn);

    await runJob('sequential');
    await runJob('sequential');

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clears the running flag even when the job throws', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    await registerJob('throws', 60_000, fn);

    await runJob('throws').catch(() => {});
    await runJob('throws');

    expect(fn).toHaveBeenCalledTimes(2);
    expect(getJob('throws')!.running).toBe(false);
  });
});

describe('persistence', () => {
  it('restores lastRunAt from a previous session on register', async () => {
    const previousRun = Date.now() - 120_000;
    (schedulerDeps.loadLastRunAt as jest.Mock).mockResolvedValue(previousRun);

    const fn = jest.fn().mockResolvedValue(undefined);
    await registerJob('restore', 60_000, fn);

    expect(getJob('restore')!.lastRunAt).toBe(previousRun);
  });

  it('overwrites lastRunAt in persistence after each run', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    await registerJob('overwrite', 60_000, fn);

    await runJob('overwrite');
    const firstTs = (schedulerDeps.saveLastRunAt as jest.Mock).mock.calls[0][1];

    await runJob('overwrite');
    const secondTs = (schedulerDeps.saveLastRunAt as jest.Mock).mock.calls[1][1];

    expect(secondTs).toBeGreaterThanOrEqual(firstTs);
    expect(schedulerDeps.saveLastRunAt).toHaveBeenCalledTimes(2);
  });
});
