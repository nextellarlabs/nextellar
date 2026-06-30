/**
 * HTTP Routes for Backup Verification
 * Provides manual trigger and status endpoints.
 */

import { Router } from 'express';
import {
  verifyBackup,
  findLatestBackup,
  type VerifyOptions,
} from '../lib/backupVerify.js';
import {
  getAllJobStatuses,
  getJobStatus,
  runJobNow,
  scheduleJob,
  type JobConfig,
} from '../lib/scheduler.js';
import { getAlertHistory } from '../lib/alertHooks.js';

const router = Router();

// GET /backup-verify/status - Overall status
router.get('/status', async (_req, res, next) => {
  try {
    const jobStatuses = getAllJobStatuses();
    const recentAlerts = getAlertHistory().slice(-10);

    res.json({
      healthy: jobStatuses.every((s) => !s.running && (s.lastResult?.healthy ?? true)),
      jobs: jobStatuses,
      recentAlerts,
    });
  } catch (err) {
    next(err);
  }
});

// GET /backup-verify/jobs/:id - Specific job status
router.get('/jobs/:id', async (req, res, next) => {
  try {
    const status = getJobStatus(req.params.id);
    if (!status) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json(status);
  } catch (err) {
    next(err);
  }
});

// POST /backup-verify/jobs - Schedule a new job
router.post('/jobs', async (req, res, next) => {
  try {
    const { id, intervalMinutes, verifyOptions, enabled = true } = req.body;

    if (!id || !intervalMinutes || !verifyOptions) {
      res.status(400).json({
        error: 'Missing required fields: id, intervalMinutes, verifyOptions',
      });
      return;
    }

    const config: JobConfig = {
      id,
      cronExpression: `*/${intervalMinutes} * * * *`,
      intervalMinutes,
      verifyOptions: verifyOptions as VerifyOptions,
      enabled,
    };

    const status = scheduleJob(config);
    res.status(201).json(status);
  } catch (err) {
    next(err);
  }
});

// POST /backup-verify/jobs/:id/run - Manual trigger
router.post('/jobs/:id/run', async (req, res, next) => {
  try {
    const result = await runJobNow(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /backup-verify/verify - One-off verification
router.post('/verify', async (req, res, next) => {
  try {
    const { backupDir, sampleSize, timeoutMs } = req.body;

    if (!backupDir) {
      res.status(400).json({ error: 'backupDir is required' });
      return;
    }

    const options: VerifyOptions = {
      backupDir,
      sampleSize,
      timeoutMs,
    };

    const result = await verifyBackup(options);
    res.status(result.healthy ? 200 : 500).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /backup-verify/latest - Find latest backup info
router.get('/latest', async (req, res, next) => {
  try {
    const { backupDir } = req.query;

    if (!backupDir || typeof backupDir !== 'string') {
      res.status(400).json({ error: 'backupDir query parameter is required' });
      return;
    }

    const backup = await findLatestBackup(backupDir);
    if (!backup) {
      res.status(404).json({ error: 'No backup found' });
      return;
    }

    res.json(backup);
  } catch (err) {
    next(err);
  }
});

export default router;