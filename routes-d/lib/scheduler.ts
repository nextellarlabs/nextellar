export type JobFn = () => Promise<void>;

export interface JobRecord {
  name: string;
  intervalMs: number;
  fn: JobFn;
  lastRunAt: number | null;
  running: boolean;
  handle: ReturnType<typeof setInterval> | null;
}

const jobs = new Map<string, JobRecord>();

export const schedulerDeps = {
  async loadLastRunAt(_name: string): Promise<number | null> {
    return null;
  },
  async saveLastRunAt(_name: string, _ts: number): Promise<void> {},
};

export async function registerJob(
  name: string,
  intervalMs: number,
  fn: JobFn,
): Promise<void> {
  if (jobs.has(name)) return;

  const lastRunAt = await schedulerDeps.loadLastRunAt(name);

  const record: JobRecord = {
    name,
    intervalMs,
    fn,
    lastRunAt,
    running: false,
    handle: null,
  };

  jobs.set(name, record);

  record.handle = setInterval(() => {
    void runJob(name);
  }, intervalMs);
}

export async function runJob(name: string): Promise<void> {
  const record = jobs.get(name);
  if (!record) return;

  if (record.running) return;

  record.running = true;
  const now = Date.now();

  try {
    await record.fn();
    record.lastRunAt = now;
    await schedulerDeps.saveLastRunAt(name, now);
  } finally {
    record.running = false;
  }
}

export function getJob(name: string): JobRecord | undefined {
  return jobs.get(name);
}

export function stopJob(name: string): void {
  const record = jobs.get(name);
  if (!record || record.handle === null) return;
  clearInterval(record.handle);
  record.handle = null;
}

export function clearJobs(): void {
  for (const name of jobs.keys()) {
    stopJob(name);
  }
  jobs.clear();
}
