/**
 * Unit tests for backupVerify.ts
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  verifyBackup,
  findLatestBackup,
  restoreBackup,
  checkConsistency,
  isBackupRecent,
  BackupNotFoundError,
  RestoreMismatchError,
  ConsistencyCheckError,
  type BackupMetadata,
  type VerifyOptions,
} from '../../lib/backupVerify.js';

describe('backupVerify', () => {
  let tempDir: string;
  let backupDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-test-'));
    backupDir = path.join(tempDir, 'backups');
    await fs.ensureDir(backupDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe('findLatestBackup', () => {
    it('returns null when backup directory does not exist', async () => {
      const result = await findLatestBackup('/nonexistent/path');
      expect(result).toBeNull();
    });

    it('returns null when backup directory is empty', async () => {
      const result = await findLatestBackup(backupDir);
      expect(result).toBeNull();
    });

    it('finds the most recent backup file', async () => {
      const file1 = path.join(backupDir, 'backup-2024-01-01.sql.gz');
      const file2 = path.join(backupDir, 'backup-2024-01-02.sql.gz');

      // Create dummy gz files
      await fs.writeFile(file1, 'backup1');
      await fs.writeFile(file2, 'backup2');

      // Set different modification times
      const date1 = new Date('2024-01-01');
      const date2 = new Date('2024-01-02');
      await fs.utimes(file1, date1, date1);
      await fs.utimes(file2, date2, date2);

      const result = await findLatestBackup(backupDir);
      expect(result).not.toBeNull();
      expect(result!.source).toBe(file2);
      expect(result!.id).toBe('backup-2024-01-02');
    });
  });

  describe('restoreBackup', () => {
    it('successfully restores a valid gzip backup', async () => {
      const metadata: BackupMetadata = {
        id: 'test-backup',
        createdAt: new Date(),
        sizeBytes: 100,
        checksum: 'abc123',
        source: path.join(backupDir, 'test.sql.gz'),
        type: 'full',
      };

      // Create a valid gzipped SQL file
      const { execSync } = require('child_process');
      const sqlContent = 'CREATE TABLE users (id INT); INSERT INTO users VALUES (1); COMMIT;';
      const rawPath = path.join(tempDir, 'raw.sql');
      await fs.writeFile(rawPath, sqlContent);
      execSync(`gzip -c ${rawPath} > ${metadata.source}`);

      const restoreDir = path.join(tempDir, 'restore');
      const result = await restoreBackup(metadata, restoreDir);

      expect(await fs.pathExists(result)).toBe(true);
      const restoredSql = await fs.readFile(path.join(result, 'dump.sql'), 'utf-8');
      expect(restoredSql).toContain('CREATE TABLE');
      expect(restoredSql).toContain('INSERT INTO');
    });

    it('throws on missing source file', async () => {
      const metadata: BackupMetadata = {
        id: 'missing',
        createdAt: new Date(),
        sizeBytes: 0,
        checksum: '',
        source: '/nonexistent/backup.sql.gz',
        type: 'full',
      };

      await expect(restoreBackup(metadata, tempDir)).rejects.toThrow();
    });
  });

  describe('checkConsistency', () => {
    it('passes for valid SQL dump', async () => {
      const restoreDir = path.join(tempDir, 'restore');
      await fs.ensureDir(restoreDir);
      await fs.writeFile(
        path.join(restoreDir, 'dump.sql'),
        'CREATE TABLE users (id INT);\nINSERT INTO users VALUES (1);\nINSERT INTO users VALUES (2);\nCOMMIT;'
      );

      const result = await checkConsistency(restoreDir, 10);
      expect(result.recordCount).toBe(2);
      expect(result.sampleVerified).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('fails for missing SQL markers', async () => {
      const restoreDir = path.join(tempDir, 'restore');
      await fs.ensureDir(restoreDir);
      await fs.writeFile(path.join(restoreDir, 'dump.sql'), 'INVALID SQL;');

      const result = await checkConsistency(restoreDir);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes('CREATE TABLE'))).toBe(true);
    });

    it('throws when dump file is missing', async () => {
      await expect(checkConsistency(tempDir)).rejects.toThrow(ConsistencyCheckError);
    });
  });

  describe('verifyBackup (success case)', () => {
    it('returns healthy report for valid backup', async () => {
      // Create a valid backup
      const { execSync } = require('child_process');
      const sqlContent =
        'CREATE TABLE users (id INT);\n' +
        'INSERT INTO users VALUES (1);\n' +
        'INSERT INTO users VALUES (2);\n' +
        'COMMIT;';
      const rawPath = path.join(tempDir, 'raw.sql');
      await fs.writeFile(rawPath, sqlContent);
      execSync(`gzip -c ${rawPath} > ${path.join(backupDir, 'backup-latest.sql.gz')}`);

      const result = await verifyBackup({
        backupDir,
        tempRestoreDir: path.join(tempDir, 'restore'),
      });

      expect(result.backupFound).toBe(true);
      expect(result.healthy).toBe(true);
      expect(result.backupMetadata).toBeDefined();
      expect(result.restoreResult?.success).toBe(true);
      expect(result.restoreResult?.consistencyCheck).toBe(true);
      expect(result.alerts).toHaveLength(0);
    });
  });

  describe('verifyBackup (missing backup)', () => {
    it('returns unhealthy report when no backup exists', async () => {
      const result = await verifyBackup({
        backupDir: '/nonexistent',
        tempRestoreDir: path.join(tempDir, 'restore'),
      });

      expect(result.backupFound).toBe(false);
      expect(result.healthy).toBe(false);
      expect(result.alerts.length).toBeGreaterThan(0);
    });
  });

  describe('verifyBackup (restore mismatch)', () => {
    it('detects corrupted backup', async () => {
      // Create a corrupted/empty gzip
      await fs.writeFile(path.join(backupDir, 'corrupt.sql.gz'), 'not-valid-gzip-data');

      const result = await verifyBackup({
        backupDir,
        tempRestoreDir: path.join(tempDir, 'restore'),
      });

      expect(result.healthy).toBe(false);
      expect(result.alerts.length).toBeGreaterThan(0);
    });
  });

  describe('isBackupRecent', () => {
    it('returns true for recent backup', () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      expect(isBackupRecent(oneHourAgo, 24)).toBe(true);
    });

    it('returns false for old backup', () => {
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      expect(isBackupRecent(twoDaysAgo, 24)).toBe(false);
    });
  });
});