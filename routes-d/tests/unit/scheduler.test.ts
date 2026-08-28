/**
 * Unit tests for scheduler.ts
 */

import {
  scheduleJob,
  startJob,
  stopJob,
  unscheduleJob,
  getJobStatus,
  getAllJobStatuses,
  runJobNow,
  stopAllJobs,
  type JobConfig,
} from '../../lib/scheduler.js';
import {
  clearAlertHandlers,
  clearAlertHistory,
  getAlertHistory,
} from '../../lib/alertHooks.js';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('scheduler', () => {
  let tempDir: string;
  let backupDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scheduler-test-'));
    backupDir = path.join(tempDir, 'backups');
    await fs.ensureDir(backupDir);
    clearAlertHandlers();
    clearAlertHistory();
  });

  afterEach(async () => {
    stopAllJobs();
    unscheduleJob('test-job');
    await fs.remove(tempDir);
  });

  describe('scheduleJob', () => {
    it('creates a job with correct initial status', () => {
      const config: JobConfig = {
        id: 'test-job',
        cronExpression: '*/5 * * * *',
        intervalMinutes: 5,
        verifyOptions: { backupDir },
        enabled: false,
      };

      const status = scheduleJob(config);

      expect(status.id).toBe('test-job');
      expect(status.running).toBe(false);
      expect(status.runCount).toBe(0);
      expect(status.failCount).toBe(0);
      expect(status.lastRun).toBeNull();
    });
  });

  describe('runJobNow', () => {
    it('successfully runs a verification job', async () => {
      // Create a valid backup
      const { execSync } = require('child_process');
      const sqlContent =
        'CREATE TABLE users (id INT);\nINSERT INTO users VALUES (1);\nCOMMIT;';
      const rawPath = path.join(tempDir, 'raw.sql');
      await fs.writeFile(rawPath, sqlContent);
      execSync(`gzip -c ${rawPath} > ${path.join(backupDir, 'backup.sql.gz')}`);

      const config: JobConfig = {
        id: 'test-job',
        cronExpression: '*/5 * * * *',
        intervalMinutes: 5,
        verifyOptions: { backupDir, tempRestoreDir: path.join(tempDir, 'restore') },
        enabled: false,
      };

      scheduleJob(config);

      const result = await runJobNow('test-job');

      expect(result.backupFound).toBe(true);
      expect(result.healthy).toBe(true);

      const status = getJobStatus('test-job')!;
      expect(status.runCount).toBe(1);
      expect(status.failCount).toBe(0);
      expect(status.lastResult).toBeDefined();
    });

    it('throws for non-existent job', async () => {
      await expect(runJobNow('nonexistent')).rejects.toThrow('Job nonexistent not found');
    });

    it('sends alert on verification failure', async () => {
      const config: JobConfig = {
        id: 'test-job',
        cronExpression: '*/5 * * * *',
        intervalMinutes: 5,
        verifyOptions: { backupDir: '/nonexistent', tempRestoreDir: path.join(tempDir, 'restore') },
        enabled: false,
      };

      scheduleJob(config);

      const result = await runJobNow('test-job');

      expect(result.healthy).toBe(false);

      const history = getAlertHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].severity).toBe('error');
    });
  });

  describe('getJobStatus', () => {
    it('returns undefined for unknown job', () => {
      expect(getJobStatus('unknown')).toBeUndefined();
    });

    it('returns current status for scheduled job', () => {
      const config: JobConfig = {
        id: 'test-job',
        cronExpression: '*/5 * * * *',
        intervalMinutes: 5,
        verifyOptions: { backupDir },
        enabled: false,
      };

      scheduleJob(config);
      const status = getJobStatus('test-job');

      expect(status).toBeDefined();
      expect(status!.id).toBe('test-job');
    });
  });

  describe('getAllJobStatuses', () => {
    it('returns all scheduled jobs', () => {
      scheduleJob({
        id: 'job-1',
        cronExpression: '*/5 * * * *',
        intervalMinutes: 5,
        verifyOptions: { backupDir },
        enabled: false,
      });

      scheduleJob({
        id: 'job-2',
        cronExpression: '*/10 * * * *',
        intervalMinutes: 10,
        verifyOptions: { backupDir },
        enabled: false,
      });

      const statuses = getAllJobStatuses();
      expect(statuses).toHaveLength(2);
      expect(statuses.map((s) => s.id)).toContain('job-1');
      expect(statuses.map((s) => s.id)).toContain('job-2');
    });
  });

  describe('stopJob / unscheduleJob', () => {
    it('stops a running job timer', () => {
      const config: JobConfig = {
        id: 'test-job',
        cronExpression: '*/5 * * * *',
        intervalMinutes: 5,
        verifyOptions: { backupDir },
        enabled: true,
      };

      scheduleJob(config);
      stopJob('test-job');

      // Should not throw and timer should be cleared
      expect(getJobStatus('test-job')).toBeDefined();
    });

    it('removes job completely on unschedule', () => {
      const config: JobConfig = {
        id: 'test-job',
        cronExpression: '*/5 * * * *',
        intervalMinutes: 5,
        verifyOptions: { backupDir },
        enabled: false,
      };

      scheduleJob(config);
      unscheduleJob('test-job');

      expect(getJobStatus('test-job')).toBeUndefined();
    });
  });
});