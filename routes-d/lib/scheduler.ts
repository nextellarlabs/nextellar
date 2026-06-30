/**
 * Background Job Scheduler
 * Simple in-memory scheduler for backup verification jobs.
 */

import { verifyBackup, type VerifyOptions, type BackupVerificationReport } from './backupVerify.js';
import { sendBackupAlert } from './alertHooks.js';

export interface JobConfig {
  id: string;
  cronExpression: string; // Simplified: interval in minutes for MVP
  intervalMinutes: number;
  verifyOptions: VerifyOptions;
  enabled: boolean;
}

export interface JobStatus {
  id: string;
  lastRun: Date | null;
  lastResult: BackupVerificationReport | null;
  nextRun: Date;
  running: boolean;
  runCount: number;
  failCount: number;
}

// In-memory job store
const jobs = new Map<string, JobConfig>();
const statuses = new Map<string, JobStatus>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Register a new backup verification job
 */
export function scheduleJob(config: JobConfig): JobStatus {
  jobs.set(config.id, config);

  const status: JobStatus = {
    id: config.id,
    lastRun: null,
    lastResult: null,
    nextRun: new Date(Date.now() + config.intervalMinutes * 60 * 1000),
    running: false,
    runCount: 0,
    failCount: 0,
  };

  statuses.set(config.id, status);

  if (config.enabled) {
    startJob(config.id);
  }

  return status;
}

/**
 * Start a scheduled job
 */
export function startJob(jobId: string): void {
  const config = jobs.get(jobId);
  if (!config) {
    throw new Error(`Job ${jobId} not found`);
  }

  // Clear existing timer if any
  stopJob(jobId);

  const runNext = async () => {
    const status = statuses.get(jobId);
    if (!status || status.running) return;

    status.running = true;
    status.lastRun = new Date();

    try {
      const result = await verifyBackup(config.verifyOptions);
      status.lastResult = result;
      status.runCount++;

      if (!result.healthy) {
        status.failCount++;
        await sendBackupAlert(
          false,
          `Backup verification failed for job ${jobId}: ${result.alerts.join(', ')}`,
          { jobId, result }
        );
      } else {
        await sendBackupAlert(
          true,
          `Backup verification passed for job ${jobId}`,
          { jobId, result }
        );
      }
    } catch (error) {
      status.failCount++;
      const message = error instanceof Error ? error.message : String(error);
      await sendBackupAlert(
        false,
        `Backup verification error for job ${jobId}: ${message}`,
        { jobId, error: message }
      );
    } finally {
      status.running = false;
      status.nextRun = new Date(Date.now() + config.intervalMinutes * 60 * 1000);

      // Schedule next run
      const timer = setTimeout(runNext, config.intervalMinutes * 60 * 1000);
      timers.set(jobId, timer);
    }
  };

  // Initial run
  const timer = setTimeout(runNext, 1000); // Start almost immediately
  timers.set(jobId, timer);
}

/**
 * Stop a scheduled job
 */
export function stopJob(jobId: string): void {
  const timer = timers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(jobId);
  }

  const status = statuses.get(jobId);
  if (status) {
    status.running = false;
  }
}

/**
 * Remove a job completely
 */
export function unscheduleJob(jobId: string): void {
  stopJob(jobId);
  jobs.delete(jobId);
  statuses.delete(jobId);
}

/**
 * Get status of a job
 */
export function getJobStatus(jobId: string): JobStatus | undefined {
  const status = statuses.get(jobId);
  return status ? { ...status } : undefined;
}

/**
 * Get all job statuses
 */
export function getAllJobStatuses(): JobStatus[] {
  return Array.from(statuses.values()).map((s) => ({ ...s }));
}

/**
 * Stop all jobs (for graceful shutdown)
 */
export function stopAllJobs(): void {
  for (const [id] of timers) {
    stopJob(id);
  }
}

/**
 * Run a job immediately (for manual trigger)
 */
export async function runJobNow(jobId: string): Promise<BackupVerificationReport> {
  const config = jobs.get(jobId);
  if (!config) {
    throw new Error(`Job ${jobId} not found`);
  }

  const status = statuses.get(jobId);
  if (status?.running) {
    throw new Error(`Job ${jobId} is already running`);
  }

  if (status) {
    status.running = true;
    status.lastRun = new Date();
  }

  try {
    const result = await verifyBackup(config.verifyOptions);
    if (status) {
      status.lastResult = result;
      status.runCount++;
      if (!result.healthy) {
        status.failCount++;
      }
    }
    return result;
  } finally {
    if (status) {
      status.running = false;
    }
  }
}