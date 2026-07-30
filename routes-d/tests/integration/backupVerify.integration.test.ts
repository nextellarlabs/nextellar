/**
 * Integration tests for backup verification end-to-end
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import request from 'supertest';
import express from 'express';
import backupVerifyRouter from '../../routes/backupVerifyRoute.js';
import { clearAlertHandlers, clearAlertHistory } from '../../lib/alertHooks.js';
import { stopAllJobs, unscheduleJob } from '../../lib/scheduler.js';

describe('Backup Verification Integration', () => {
  let app: express.Express;
  let tempDir: string;
  let backupDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'integration-test-'));
    backupDir = path.join(tempDir, 'backups');
    await fs.ensureDir(backupDir);

    clearAlertHandlers();
    clearAlertHistory();

    app = express();
    app.use(express.json());
    app.use('/backup-verify', backupVerifyRouter);
  });

  afterEach(async () => {
    stopAllJobs();
    unscheduleJob('integ-test-job');
    await fs.remove(tempDir);
  });

  describe('POST /backup-verify/verify', () => {
    it('returns 200 for healthy backup', async () => {
      const { execSync } = require('child_process');
      const sqlContent =
        'CREATE TABLE users (id INT);\n' +
        'INSERT INTO users VALUES (1);\n' +
        'INSERT INTO users VALUES (2);\n' +
        'INSERT INTO users VALUES (3);\n' +
        'COMMIT;';
      const rawPath = path.join(tempDir, 'raw.sql');
      await fs.writeFile(rawPath, sqlContent);
      execSync(`gzip -c ${rawPath} > ${path.join(backupDir, 'backup.sql.gz')}`);

      const response = await request(app)
        .post('/backup-verify/verify')
        .send({ backupDir, sampleSize: 10 });

      expect(response.status).toBe(200);
      expect(response.body.healthy).toBe(true);
      expect(response.body.backupFound).toBe(true);
      expect(response.body.restoreResult.success).toBe(true);
    });

    it('returns 500 for failed verification', async () => {
      const response = await request(app)
        .post('/backup-verify/verify')
        .send({ backupDir: '/nonexistent' });

      expect(response.status).toBe(500);
      expect(response.body.healthy).toBe(false);
      expect(response.body.backupFound).toBe(false);
    });

    it('returns 400 for missing backupDir', async () => {
      const response = await request(app).post('/backup-verify/verify').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('backupDir');
    });
  });

  describe('GET /backup-verify/latest', () => {
    it('returns latest backup metadata', async () => {
      const { execSync } = require('child_process');
      const sqlContent = 'CREATE TABLE t (id INT); INSERT INTO t VALUES (1); COMMIT;';
      const rawPath = path.join(tempDir, 'raw.sql');
      await fs.writeFile(rawPath, sqlContent);
      execSync(`gzip -c ${rawPath} > ${path.join(backupDir, 'latest.sql.gz')}`);

      const response = await request(app)
        .get('/backup-verify/latest')
        .query({ backupDir });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('latest');
      expect(response.body.sizeBytes).toBeGreaterThan(0);
      expect(response.body.checksum).toBeDefined();
    });

    it('returns 404 when no backup exists', async () => {
      const response = await request(app)
        .get('/backup-verify/latest')
        .query({ backupDir });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /backup-verify/status', () => {
    it('returns overall system status', async () => {
      const response = await request(app).get('/backup-verify/status');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('healthy');
      expect(response.body).toHaveProperty('jobs');
      expect(response.body).toHaveProperty('recentAlerts');
    });
  });

  describe('POST /backup-verify/jobs and POST /jobs/:id/run', () => {
    it('schedules and runs a job', async () => {
      const { execSync } = require('child_process');
      const sqlContent = 'CREATE TABLE t (id INT); INSERT INTO t VALUES (1); COMMIT;';
      const rawPath = path.join(tempDir, 'raw.sql');
      await fs.writeFile(rawPath, sqlContent);
      execSync(`gzip -c ${rawPath} > ${path.join(backupDir, 'job-test.sql.gz')}`);

      // Schedule job
      const scheduleResponse = await request(app).post('/backup-verify/jobs').send({
        id: 'integ-test-job',
        intervalMinutes: 60,
        verifyOptions: {
          backupDir,
          tempRestoreDir: path.join(tempDir, 'restore'),
        },
        enabled: false,
      });

      expect(scheduleResponse.status).toBe(201);
      expect(scheduleResponse.body.id).toBe('integ-test-job');

      // Run job manually
      const runResponse = await request(app)
        .post('/backup-verify/jobs/integ-test-job/run')
        .send();

      expect(runResponse.status).toBe(200);
      expect(runResponse.body.healthy).toBe(true);
    });
  });
});