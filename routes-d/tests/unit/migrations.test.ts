/**
 * Unit tests for migrations.ts
 */

import {
  applyMigrations,
  getAppliedMigrations,
  isMigrationApplied,
  rollbackMigration,
  clearMigrationMeta,
  getMigrationStatus,
  type Migration,
  type MigrationOptions,
} from '../../lib/migrations.js';

describe('migrations', () => {
  beforeEach(async () => {
    await clearMigrationMeta();
  });

  afterEach(async () => {
    await clearMigrationMeta();
  });

  describe('applyMigrations - fresh apply', () => {
    it('applies migrations in version order', async () => {
      const migrations: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {},
        },
        {
          version: '003',
          name: 'third',
          up: async () => {},
        },
        {
          version: '002',
          name: 'second',
          up: async () => {},
        },
      ];

      const result = await applyMigrations(migrations);

      expect(result.success).toBe(true);
      expect(result.applied).toHaveLength(3);
      expect(result.applied.map((m) => m.version)).toEqual(['001', '002', '003']);
      expect(result.skipped).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('executes migration up functions', async () => {
      const executionOrder: string[] = [];

      const migrations: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {
            executionOrder.push('001');
          },
        },
        {
          version: '002',
          name: 'second',
          up: async () => {
            executionOrder.push('002');
          },
        },
      ];

      await applyMigrations(migrations);

      expect(executionOrder).toEqual(['001', '002']);
    });

    it('handles synchronous migration up functions', async () => {
      const executionOrder: string[] = [];

      const migrations: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: () => {
            executionOrder.push('001');
          },
        },
        {
          version: '002',
          name: 'second',
          up: () => {
            executionOrder.push('002');
          },
        },
      ];

      await applyMigrations(migrations);

      expect(executionOrder).toEqual(['001', '002']);
    });
  });

  describe('applyMigrations - idempotent reapply', () => {
    it('skips already applied migrations', async () => {
      const migrations: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {},
        },
        {
          version: '002',
          name: 'second',
          up: async () => {},
        },
      ];

      // First application
      const result1 = await applyMigrations(migrations);
      expect(result1.applied).toHaveLength(2);

      // Second application (idempotent)
      const result2 = await applyMigrations(migrations);
      expect(result2.success).toBe(true);
      expect(result2.applied).toHaveLength(0);
      expect(result2.skipped).toHaveLength(2);
      expect(result2.skipped.map((m) => m.version)).toEqual(['001', '002']);
    });

    it('applies only new migrations when some are already applied', async () => {
      const migrations1: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {},
        },
        {
          version: '002',
          name: 'second',
          up: async () => {},
        },
      ];

      await applyMigrations(migrations1);

      const migrations2: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {},
        },
        {
          version: '002',
          name: 'second',
          up: async () => {},
        },
        {
          version: '003',
          name: 'third',
          up: async () => {},
        },
      ];

      const result = await applyMigrations(migrations2);

      expect(result.success).toBe(true);
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0].version).toBe('003');
      expect(result.skipped).toHaveLength(2);
    });
  });

  describe('applyMigrations - dry-run mode', () => {
    it('does not execute migrations in dry-run mode', async () => {
      const executionOrder: string[] = [];

      const migrations: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {
            executionOrder.push('001');
          },
        },
        {
          version: '002',
          name: 'second',
          up: async () => {
            executionOrder.push('002');
          },
        },
      ];

      const options: MigrationOptions = { dryRun: true };
      const result = await applyMigrations(migrations, options);

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.applied).toHaveLength(2);
      expect(executionOrder).toHaveLength(0); // No migrations actually executed

      // Verify migrations were not actually applied
      const applied = await getAppliedMigrations();
      expect(applied).toHaveLength(0);
    });

    it('shows what would be applied in dry-run mode', async () => {
      const migrations: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {},
        },
        {
          version: '002',
          name: 'second',
          up: async () => {},
        },
      ];

      const options: MigrationOptions = { dryRun: true };
      const result = await applyMigrations(migrations, options);

      expect(result.applied.map((m) => m.version)).toEqual(['001', '002']);
      expect(result.applied[0].name).toBe('first');
      expect(result.applied[1].name).toBe('second');
    });
  });

  describe('applyMigrations - error handling', () => {
    it('stops on first migration error', async () => {
      const migrations: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {},
        },
        {
          version: '002',
          name: 'second',
          up: async () => {
            throw new Error('Migration failed');
          },
        },
        {
          version: '003',
          name: 'third',
          up: async () => {},
        },
      ];

      const result = await applyMigrations(migrations);

      expect(result.success).toBe(false);
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0].version).toBe('001');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].migration.version).toBe('002');
      expect(result.errors[0].error.message).toBe('Migration failed');
    });

    it('does not apply failed migration', async () => {
      const migrations: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {
            throw new Error('Migration failed');
          },
        },
      ];

      const result = await applyMigrations(migrations);

      expect(result.success).toBe(false);
      expect(result.applied).toHaveLength(0);

      const isApplied = await isMigrationApplied('001');
      expect(isApplied).toBe(false);
    });

    it('validates duplicate migration versions', async () => {
      const migrations: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {},
        },
        {
          version: '001',
          name: 'duplicate',
          up: async () => {},
        },
      ];

      await expect(applyMigrations(migrations)).rejects.toThrow(
        'Duplicate migration version: 001'
      );
    });
  });

  describe('getAppliedMigrations', () => {
    it('returns empty array when no migrations applied', async () => {
      const applied = await getAppliedMigrations();
      expect(applied).toEqual([]);
    });

    it('returns applied migrations sorted by version', async () => {
      const migrations: Migration[] = [
        {
          version: '003',
          name: 'third',
          up: async () => {},
        },
        {
          version: '001',
          name: 'first',
          up: async () => {},
        },
        {
          version: '002',
          name: 'second',
          up: async () => {},
        },
      ];

      await applyMigrations(migrations);

      const applied = await getAppliedMigrations();
      expect(applied.map((m) => m.version)).toEqual(['001', '002', '003']);
    });
  });

  describe('isMigrationApplied', () => {
    it('returns false for unapplied migration', async () => {
      const isApplied = await isMigrationApplied('001');
      expect(isApplied).toBe(false);
    });

    it('returns true for applied migration', async () => {
      const migrations: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {},
        },
      ];

      await applyMigrations(migrations);

      const isApplied = await isMigrationApplied('001');
      expect(isApplied).toBe(true);
    });
  });

  describe('rollbackMigration', () => {
    it('removes migration from applied list', async () => {
      const migrations: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {},
        },
      ];

      await applyMigrations(migrations);
      expect(await isMigrationApplied('001')).toBe(true);

      await rollbackMigration('001');
      expect(await isMigrationApplied('001')).toBe(false);
    });

    it('throws error when rolling back non-existent migration', async () => {
      await expect(rollbackMigration('001')).rejects.toThrow(
        'Migration 001 not found in applied migrations'
      );
    });
  });

  describe('getMigrationStatus', () => {
    it('returns empty status when no migrations', async () => {
      const status = await getMigrationStatus([]);

      expect(status.applied).toHaveLength(0);
      expect(status.pending).toHaveLength(0);
    });

    it('returns all migrations as pending when none applied', async () => {
      const migrations: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {},
        },
        {
          version: '002',
          name: 'second',
          up: async () => {},
        },
      ];

      const status = await getMigrationStatus(migrations);

      expect(status.applied).toHaveLength(0);
      expect(status.pending).toHaveLength(2);
      expect(status.pending.map((m) => m.version)).toEqual(['001', '002']);
    });

    it('separates applied and pending migrations', async () => {
      const migrations1: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {},
        },
      ];

      await applyMigrations(migrations1);

      const migrations2: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {},
        },
        {
          version: '002',
          name: 'second',
          up: async () => {},
        },
        {
          version: '003',
          name: 'third',
          up: async () => {},
        },
      ];

      const status = await getMigrationStatus(migrations2);

      expect(status.applied).toHaveLength(1);
      expect(status.applied[0].version).toBe('001');
      expect(status.pending).toHaveLength(2);
      expect(status.pending.map((m) => m.version)).toEqual(['002', '003']);
    });

    it('sorts pending migrations by version', async () => {
      const migrations: Migration[] = [
        {
          version: '003',
          name: 'third',
          up: async () => {},
        },
        {
          version: '001',
          name: 'first',
          up: async () => {},
        },
        {
          version: '002',
          name: 'second',
          up: async () => {},
        },
      ];

      const status = await getMigrationStatus(migrations);

      expect(status.pending.map((m) => m.version)).toEqual(['001', '002', '003']);
    });
  });

  describe('clearMigrationMeta', () => {
    it('clears all migration metadata', async () => {
      const migrations: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {},
        },
        {
          version: '002',
          name: 'second',
          up: async () => {},
        },
      ];

      await applyMigrations(migrations);
      expect(await getAppliedMigrations()).toHaveLength(2);

      await clearMigrationMeta();
      expect(await getAppliedMigrations()).toHaveLength(0);
    });
  });
});
