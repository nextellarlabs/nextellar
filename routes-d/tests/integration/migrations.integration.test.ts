/**
 * Integration tests for migrations.ts
 * Tests end-to-end migration workflows simulating real database schema evolution
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

describe('Migrations Integration', () => {
  beforeEach(async () => {
    await clearMigrationMeta();
  });

  afterEach(async () => {
    await clearMigrationMeta();
  });

  describe('Real-world migration workflow', () => {
    it('handles complete database evolution lifecycle', async () => {
      // Simulate initial schema
      const initialMigrations: Migration[] = [
        {
          version: '001',
          name: 'create_users_table',
          up: async () => {
            // Simulate CREATE TABLE users
          },
        },
        {
          version: '002',
          name: 'create_posts_table',
          up: async () => {
            // Simulate CREATE TABLE posts
          },
        },
      ];

      // Apply initial migrations
      const initialResult = await applyMigrations(initialMigrations);
      expect(initialResult.success).toBe(true);
      expect(initialResult.applied).toHaveLength(2);

      // Verify status
      const status1 = await getMigrationStatus(initialMigrations);
      expect(status1.applied).toHaveLength(2);
      expect(status1.pending).toHaveLength(0);

      // Add new migration for feature
      const featureMigrations: Migration[] = [
        {
          version: '001',
          name: 'create_users_table',
          up: async () => {},
        },
        {
          version: '002',
          name: 'create_posts_table',
          up: async () => {},
        },
        {
          version: '003',
          name: 'add_comments_table',
          up: async () => {
            // Simulate CREATE TABLE comments
          },
        },
      ];

      // Apply only the new migration
      const featureResult = await applyMigrations(featureMigrations);
      expect(featureResult.success).toBe(true);
      expect(featureResult.applied).toHaveLength(1);
      expect(featureResult.applied[0].version).toBe('003');
      expect(featureResult.skipped).toHaveLength(2);

      // Verify final status
      const status2 = await getMigrationStatus(featureMigrations);
      expect(status2.applied).toHaveLength(3);
      expect(status2.pending).toHaveLength(0);
    });

    it('handles migration rollback and reapply', async () => {
      const migrations: Migration[] = [
        {
          version: '001',
          name: 'initial_schema',
          up: async () => {},
        },
        {
          version: '002',
          name: 'add_index',
          up: async () => {},
        },
      ];

      // Apply migrations
      await applyMigrations(migrations);
      expect(await getAppliedMigrations()).toHaveLength(2);

      // Rollback last migration
      await rollbackMigration('002');
      expect(await getAppliedMigrations()).toHaveLength(1);
      expect(await isMigrationApplied('001')).toBe(true);
      expect(await isMigrationApplied('002')).toBe(false);

      // Re-apply the rolled back migration
      const reapplyResult = await applyMigrations(migrations);
      expect(reapplyResult.success).toBe(true);
      expect(reapplyResult.applied).toHaveLength(1);
      expect(reapplyResult.applied[0].version).toBe('002');
      expect(await getAppliedMigrations()).toHaveLength(2);
    });
  });

  describe('Dry-run in production-like scenario', () => {
    it('validates migration plan without executing', async () => {
      // Simulate production state with existing migrations
      const existingMigrations: Migration[] = [
        {
          version: '001',
          name: 'create_users_table',
          up: async () => {},
        },
        {
          version: '002',
          name: 'create_posts_table',
          up: async () => {},
        },
      ];

      await applyMigrations(existingMigrations);

      // New migrations to be deployed
      const newMigrations: Migration[] = [
        {
          version: '001',
          name: 'create_users_table',
          up: async () => {},
        },
        {
          version: '002',
          name: 'create_posts_table',
          up: async () => {},
        },
        {
          version: '003',
          name: 'add_comments_table',
          up: async () => {
            throw new Error('Should not execute in dry-run');
          },
        },
        {
          version: '004',
          name: 'add_likes_table',
          up: async () => {
            throw new Error('Should not execute in dry-run');
          },
        },
      ];

      // Dry-run to validate plan
      const dryRunOptions: MigrationOptions = { dryRun: true };
      const dryRunResult = await applyMigrations(newMigrations, dryRunOptions);

      expect(dryRunResult.success).toBe(true);
      expect(dryRunResult.dryRun).toBe(true);
      expect(dryRunResult.applied).toHaveLength(2); // Only new migrations
      expect(dryRunResult.applied.map((m) => m.version)).toEqual(['003', '004']);
      expect(dryRunResult.skipped).toHaveLength(2); // Existing migrations

      // Verify no actual changes were made
      const applied = await getAppliedMigrations();
      expect(applied).toHaveLength(2);
      expect(applied.map((m) => m.version)).toEqual(['001', '002']);
    });
  });

  describe('Error recovery scenarios', () => {
    it('allows retry after fixing failed migration', async () => {
      let shouldFail = true;

      const migrations: Migration[] = [
        {
          version: '001',
          name: 'first',
          up: async () => {},
        },
        {
          version: '002',
          name: 'failing_migration',
          up: async () => {
            if (shouldFail) {
              throw new Error('Temporary failure');
            }
          },
        },
        {
          version: '003',
          name: 'third',
          up: async () => {},
        },
      ];

      // First attempt - should fail
      const firstResult = await applyMigrations(migrations);
      expect(firstResult.success).toBe(false);
      expect(firstResult.applied).toHaveLength(1);
      expect(firstResult.errors).toHaveLength(1);

      // Fix the issue
      shouldFail = false;

      // Retry - should succeed
      const retryResult = await applyMigrations(migrations);
      expect(retryResult.success).toBe(true);
      expect(retryResult.applied).toHaveLength(2); // 002 and 003
      expect(retryResult.applied.map((m) => m.version)).toEqual(['002', '003']);
      expect(retryResult.skipped).toHaveLength(1); // 001 already applied
    });

    it('handles partial migration state correctly', async () => {
      // Apply some migrations manually
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

      // Simulate a scenario where we have a gap in versions
      const migrationsWithGap: Migration[] = [
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
          version: '004',
          name: 'fourth',
          up: async () => {},
        },
        {
          version: '005',
          name: 'fifth',
          up: async () => {},
        },
      ];

      const result = await applyMigrations(migrationsWithGap);
      expect(result.success).toBe(true);
      expect(result.applied).toHaveLength(2); // 004 and 005
      expect(result.skipped).toHaveLength(2); // 001 and 002
    });
  });

  describe('Large migration sets', () => {
    it('handles many migrations efficiently', async () => {
      const migrations: Migration[] = [];

      // Create 50 migrations
      for (let i = 1; i <= 50; i++) {
        const version = i.toString().padStart(3, '0');
        migrations.push({
          version,
          name: `migration_${version}`,
          up: async () => {},
        });
      }

      // Shuffle to test sorting
      const shuffled = [...migrations].sort(() => Math.random() - 0.5);

      const result = await applyMigrations(shuffled);

      expect(result.success).toBe(true);
      expect(result.applied).toHaveLength(50);

      // Verify they are applied in sorted order
      const applied = await getAppliedMigrations();
      expect(applied.map((m) => m.version)).toEqual(
        Array.from({ length: 50 }, (_, i) => (i + 1).toString().padStart(3, '0'))
      );
    });

    it('handles idempotent reapply of large migration set', async () => {
      const migrations: Migration[] = [];

      for (let i = 1; i <= 100; i++) {
        const version = i.toString().padStart(3, '0');
        migrations.push({
          version,
          name: `migration_${version}`,
          up: async () => {},
        });
      }

      // First apply
      await applyMigrations(migrations);

      // Reapply - should be idempotent
      const result = await applyMigrations(migrations);

      expect(result.success).toBe(true);
      expect(result.applied).toHaveLength(0);
      expect(result.skipped).toHaveLength(100);
    });
  });

  describe('Migration status queries', () => {
    it('provides accurate status for complex scenarios', async () => {
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
        {
          version: '003',
          name: 'third',
          up: async () => {},
        },
      ];

      // Apply first two
      await applyMigrations(migrations.slice(0, 2));

      const status = await getMigrationStatus(migrations);

      expect(status.applied).toHaveLength(2);
      expect(status.applied.map((m) => m.version)).toEqual(['001', '002']);
      expect(status.pending).toHaveLength(1);
      expect(status.pending[0].version).toBe('003');
    });
  });
});
