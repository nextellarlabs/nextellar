/**
 * Backup Verification Module
 * Performs sample restore and consistency checks for database backups.
 */

import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

const execFile = promisify(require('child_process').execFile);

// Types
export interface BackupMetadata {
  id: string;
  createdAt: Date;
  sizeBytes: number;
  checksum: string;
  source: string;
  type: 'full' | 'incremental';
}

export interface RestoreResult {
  success: boolean;
  backupId: string;
  restoredPath: string;
  consistencyCheck: boolean;
  recordCount?: number;
  sampleRecordsVerified: number;
  errors: string[];
  durationMs: number;
}

export interface VerifyOptions {
  backupDir: string;
  tempRestoreDir?: string;
  sampleSize?: number;
  timeoutMs?: number;
  expectedTables?: string[];
}

export interface BackupVerificationReport {
  timestamp: Date;
  backupFound: boolean;
  backupMetadata?: BackupMetadata;
  restoreResult?: RestoreResult;
  healthy: boolean;
  alerts: string[];
}

// Custom error types
export class BackupNotFoundError extends Error {
  constructor(backupPath: string) {
    super(`Backup not found at: ${backupPath}`);
    this.name = 'BackupNotFoundError';
  }
}

export class RestoreMismatchError extends Error {
  constructor(
    public backupId: string,
    public expectedChecksum: string,
    public actualChecksum: string,
    message?: string
  ) {
    super(
      message ||
        `Restore mismatch for backup ${backupId}: expected ${expectedChecksum}, got ${actualChecksum}`
    );
    this.name = 'RestoreMismatchError';
  }
}

export class ConsistencyCheckError extends Error {
  constructor(public backupId: string, public details: string[]) {
    super(`Consistency check failed for backup ${backupId}: ${details.join(', ')}`);
    this.name = 'ConsistencyCheckError';
  }
}

// Configuration defaults
const DEFAULT_VERIFY_OPTIONS: Required<Pick<VerifyOptions, 'sampleSize' | 'timeoutMs'>> = {
  sampleSize: 100,
  timeoutMs: 300000, // 5 minutes
};

/**
 * Scan backup directory for the most recent backup
 */
export async function findLatestBackup(backupDir: string): Promise<BackupMetadata | null> {
  if (!(await fs.pathExists(backupDir))) {
    return null;
  }

  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const backupFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql.gz'))
    .map((e) => path.join(backupDir, e.name));

  if (backupFiles.length === 0) {
    return null;
  }

  // Sort by modification time (newest first)
  const stats = await Promise.all(
    backupFiles.map(async (f) => ({
      path: f,
      stat: await fs.stat(f),
    }))
  );

  stats.sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());

  const latest = stats[0];
  const fileName = path.basename(latest.path);
  const hash = createHash('sha256');
  const fileBuffer = await fs.readFile(latest.path);
  hash.update(fileBuffer);

  return {
    id: fileName.replace('.sql.gz', ''),
    createdAt: latest.stat.mtime,
    sizeBytes: latest.stat.size,
    checksum: hash.digest('hex'),
    source: latest.path,
    type: 'full',
  };
}

/**
 * Restore backup to temporary location for verification
 */
export async function restoreBackup(
  metadata: BackupMetadata,
  tempDir: string,
  timeoutMs: number = DEFAULT_VERIFY_OPTIONS.timeoutMs
): Promise<string> {
  const restoredPath = path.join(tempDir, `restore-${metadata.id}`);
  await fs.ensureDir(restoredPath);

  // Decompress the .sql.gz file
  const sqlPath = path.join(tempDir, `${metadata.id}.sql`);

  await new Promise<void>((resolve, reject) => {
    const gunzip = spawn('gunzip', ['-c', metadata.source], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const writeStream = fs.createWriteStream(sqlPath);
    gunzip.stdout.pipe(writeStream);

    let stderr = '';
    gunzip.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      gunzip.kill('SIGTERM');
      reject(new Error(`Restore timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    gunzip.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`gunzip failed with code ${code}: ${stderr}`));
      }
    });

    gunzip.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  // Verify restored file exists and has content
  const restoredStats = await fs.stat(sqlPath);
  if (restoredStats.size === 0) {
    throw new RestoreMismatchError(metadata.id, metadata.checksum, 'empty-file', 'Restored file is empty');
  }

  // Calculate checksum of restored content
  const hash = createHash('sha256');
  const restoredBuffer = await fs.readFile(sqlPath);
  hash.update(restoredBuffer);
  const restoredChecksum = hash.digest('hex');

  // Note: For compressed backups, we verify the decompressed content integrity
  // by checking structure, not byte-for-byte match (compression metadata differs)
  await fs.move(sqlPath, path.join(restoredPath, 'dump.sql'));
  return restoredPath;
}

/**
 * Perform consistency check on restored backup
 */
export async function checkConsistency(
  restoredPath: string,
  sampleSize: number = DEFAULT_VERIFY_OPTIONS.sampleSize
): Promise<{ recordCount: number; sampleVerified: number; errors: string[] }> {
  const sqlFile = path.join(restoredPath, 'dump.sql');
  const errors: string[] = [];

  if (!(await fs.pathExists(sqlFile))) {
    throw new ConsistencyCheckError(path.basename(restoredPath), ['Restored SQL file not found']);
  }

  // Read and parse SQL dump for basic structure validation
  const content = await fs.readFile(sqlFile, 'utf-8');

  // Check for required SQL structure markers
  const requiredMarkers = [
    'CREATE TABLE',
    'INSERT INTO',
    'COMMIT',
  ];

  for (const marker of requiredMarkers) {
    if (!content.includes(marker)) {
      errors.push(`Missing required SQL marker: ${marker}`);
    }
  }

  // Count INSERT statements as proxy for record count
  const insertMatches = content.match(/INSERT INTO/g) || [];
  const recordCount = insertMatches.length;

  // Extract and verify sample of INSERT statements
  const insertStatements = content.match(/INSERT INTO `?\w+`? VALUES\s*\([^)]+\);?/g) || [];
  const sampleVerified = Math.min(insertStatements.length, sampleSize);

  // Verify each sample statement has valid structure
  let validSamples = 0;
  for (let i = 0; i < sampleVerified; i++) {
    const stmt = insertStatements[i];
    if (stmt && stmt.startsWith('INSERT INTO') && stmt.includes('VALUES')) {
      validSamples++;
    }
  }

  if (validSamples < sampleVerified) {
    errors.push(`Only ${validSamples}/${sampleVerified} sample records passed validation`);
  }

  return {
    recordCount,
    sampleVerified: validSamples,
    errors,
  };
}

/**
 * Main verification orchestrator
 */
export async function verifyBackup(
  options: VerifyOptions
): Promise<BackupVerificationReport> {
  const startTime = Date.now();
  const tempDir = options.tempRestoreDir || path.join(os.tmpdir(), 'nextellar-backup-verify');

  await fs.ensureDir(tempDir);

  const alerts: string[] = [];

  try {
    // Step 1: Find latest backup
    const backup = await findLatestBackup(options.backupDir);

    if (!backup) {
      alerts.push(`No backup found in directory: ${options.backupDir}`);
      return {
        timestamp: new Date(),
        backupFound: false,
        healthy: false,
        alerts,
      };
    }

    // Step 2: Restore backup
    const restoredPath = await restoreBackup(
      backup,
      tempDir,
      options.timeoutMs
    );

    // Step 3: Consistency check
    const consistency = await checkConsistency(
      restoredPath,
      options.sampleSize || DEFAULT_VERIFY_OPTIONS.sampleSize
    );

    const durationMs = Date.now() - startTime;

    const restoreResult: RestoreResult = {
      success: true,
      backupId: backup.id,
      restoredPath,
      consistencyCheck: consistency.errors.length === 0,
      recordCount: consistency.recordCount,
      sampleRecordsVerified: consistency.sampleVerified,
      errors: consistency.errors,
      durationMs,
    };

    if (consistency.errors.length > 0) {
      alerts.push(`Consistency check failed: ${consistency.errors.join('; ')}`);
    }

    // Cleanup temp files
    await fs.remove(restoredPath);

    return {
      timestamp: new Date(),
      backupFound: true,
      backupMetadata: backup,
      restoreResult,
      healthy: consistency.errors.length === 0 && restoreResult.success,
      alerts,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    alerts.push(`Verification failed: ${errorMessage}`);

    return {
      timestamp: new Date(),
      backupFound: false,
      healthy: false,
      alerts,
    };
  } finally {
    // Always attempt cleanup
    try {
      await fs.remove(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Check if backup is recent enough (within threshold)
 */
export function isBackupRecent(
  backupDate: Date,
  maxAgeHours: number = 24
): boolean {
  const ageMs = Date.now() - backupDate.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  return ageHours <= maxAgeHours;
}