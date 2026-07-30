# Backup Verification System

## Overview

The `routes-d` backup verification system ensures database backups are restorable and consistent. It performs sample restores and consistency checks on a scheduled basis, alerting when issues are detected.

## Architecture
┌─────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Scheduler  │────▶│  Backup Verify  │────▶│ Alert Hooks  │
│  (cron-like)│     │  (restore+check)│     │ (on failure) │
└─────────────┘     └─────────────────┘     └──────────────┘
│
▼
┌──────────────┐
│  HTTP Routes  │
│ (manual trig) │
└──────────────┘


## Components

### `lib/backupVerify.ts`

Core verification logic:

- `findLatestBackup(backupDir)` — Scans for newest `.sql.gz` file
- `restoreBackup(metadata, tempDir)` — Decompresses and validates
- `checkConsistency(restoredPath, sampleSize)` — Validates SQL structure
- `verifyBackup(options)` — Orchestrates full verification pipeline

### `lib/scheduler.ts`

Background job scheduler:

- `scheduleJob(config)` — Register recurring verification
- `runJobNow(jobId)` — Manual trigger
- `startJob/stopJob/unscheduleJob` — Lifecycle management

### `lib/alertHooks.ts`

Error rate alerting:

- `sendAlert(payload)` — Dispatches to all registered handlers
- `sendBackupAlert(success, message, metadata)` — Convenience wrapper
- `registerAlertHandler(handler)` — Add custom alerting (PagerDuty, Slack, etc.)

### `routes/backupVerifyRoute.ts`

Express routes:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/backup-verify/status` | Overall system health |
| GET | `/backup-verify/jobs/:id` | Job status |
| POST | `/backup-verify/jobs` | Schedule new job |
| POST | `/backup-verify/jobs/:id/run` | Manual trigger |
| POST | `/backup-verify/verify` | One-off verification |
| GET | `/backup-verify/latest` | Latest backup info |

## Usage

### Schedule Automated Verification

```typescript
import { scheduleJob } from './lib/scheduler.js';

scheduleJob({
  id: 'nightly-backup-check',
  cronExpression: '0 2 * * *',
  intervalMinutes: 60 * 24, // Daily
  verifyOptions: {
    backupDir: '/var/backups/postgres',
    sampleSize: 500,
    timeoutMs: 600000,
  },
  enabled: true,
});

Manual One-Off Verification
curl -X POST http://localhost:3000/backup-verify/verify \
  -H 'Content-Type: application/json' \
  -d '{"backupDir": "/var/backups/postgres", "sampleSize": 100}'

  Custom Alert Handler
  import { registerAlertHandler } from './lib/alertHooks.js';

registerAlertHandler(async (payload) => {
  if (payload.severity === 'error') {
    await notifyPagerDuty(payload);
  }
});


## Testing
# Run all routes-d tests
npm test -- routes-d/tests

# Run unit tests only
npm test -- routes-d/tests/unit

# Run integration tests only
npm test -- routes-d/tests/integration


Environment Variables
| Variable                    | Default | Description                            |
| --------------------------- | ------- | -------------------------------------- |
| `BACKUP_DIR`                | —       | Default backup directory               |
| `BACKUP_MAX_AGE_HOURS`      | 24      | Alert threshold for stale backups      |
| `BACKUP_VERIFY_TIMEOUT_MS`  | 300000  | Restore operation timeout              |
| `BACKUP_VERIFY_SAMPLE_SIZE` | 100     | Records to sample in consistency check |


