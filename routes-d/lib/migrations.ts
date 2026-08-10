/**
 * Database Migration Runner
 * 
 * Provides a deterministic migration runner for schema evolution of persistent stores.
 * Supports forward migrations in order, tracks applied versions in a meta table, and provides dry-run mode.
 */

export interface Migration {
  version: string;
  name: string;
  up: () => Promise<void> | void;
  down?: () => Promise<void> | void;
}

export interface MigrationMeta {
  version: string;
  name: string;
  appliedAt: Date;
}

export interface MigrationOptions {
  dryRun?: boolean;
  metaTableName?: string;
}

export interface MigrationResult {
  success: boolean;
  applied: MigrationMeta[];
  skipped: MigrationMeta[];
  errors: Array<{ migration: Migration; error: Error }>;
  dryRun: boolean;
}

/**
 * In-memory storage for migration metadata (can be replaced with database storage)
 */
class MetaStore {
  private migrations: Map<string, MigrationMeta> = new Map();

  async getAll(): Promise<MigrationMeta[]> {
    return Array.from(this.migrations.values()).sort(
      (a, b) => a.version.localeCompare(b.version)
    );
  }

  async get(version: string): Promise<MigrationMeta | undefined> {
    return this.migrations.get(version);
  }

  async add(meta: MigrationMeta): Promise<void> {
    this.migrations.set(meta.version, meta);
  }

  async remove(version: string): Promise<void> {
    this.migrations.delete(version);
  }

  async clear(): Promise<void> {
    this.migrations.clear();
  }

  has(version: string): boolean {
    return this.migrations.has(version);
  }
}

// Global meta store instance
const metaStore = new MetaStore();

/**
 * Sort migrations by version in ascending order
 */
function sortMigrations(migrations: Migration[]): Migration[] {
  return [...migrations].sort((a, b) => a.version.localeCompare(b.version));
}

/**
 * Validate that migration versions are unique
 */
function validateMigrations(migrations: Migration[]): void {
  const versions = new Set<string>();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
    versions.add(migration.version);
  }
}

/**
 * Apply pending migrations
 * 
 * @param migrations - Array of migrations to apply
 * @param options - Migration options
 * @returns Migration result with applied, skipped, and error information
 */
export async function applyMigrations(
  migrations: Migration[],
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const { dryRun = false } = options;

  validateMigrations(migrations);
  const sortedMigrations = sortMigrations(migrations);

  const result: MigrationResult = {
    success: true,
    applied: [],
    skipped: [],
    errors: [],
    dryRun,
  };

  for (const migration of sortedMigrations) {
    const existing = await metaStore.get(migration.version);

    if (existing) {
      result.skipped.push(existing);
      continue;
    }

    try {
      if (!dryRun) {
        await migration.up();
        
        const meta: MigrationMeta = {
          version: migration.version,
          name: migration.name,
          appliedAt: new Date(),
        };
        
        await metaStore.add(meta);
        result.applied.push(meta);
      } else {
        // In dry-run mode, just record what would be applied
        result.applied.push({
          version: migration.version,
          name: migration.name,
          appliedAt: new Date(),
        });
      }
    } catch (error) {
      result.success = false;
      result.errors.push({
        migration,
        error: error as Error,
      });
      // Stop on first error
      break;
    }
  }

  return result;
}

/**
 * Get all applied migrations
 */
export async function getAppliedMigrations(): Promise<MigrationMeta[]> {
  return metaStore.getAll();
}

/**
 * Check if a specific migration version has been applied
 */
export async function isMigrationApplied(version: string): Promise<boolean> {
  return metaStore.has(version);
}

/**
 * Rollback a specific migration (if down function is provided)
 * 
 * @param version - Migration version to rollback
 */
export async function rollbackMigration(version: string): Promise<void> {
  const meta = await metaStore.get(version);
  if (!meta) {
    throw new Error(`Migration ${version} not found in applied migrations`);
  }

  await metaStore.remove(version);
}

/**
 * Clear all migration metadata (useful for testing)
 */
export async function clearMigrationMeta(): Promise<void> {
  await metaStore.clear();
}

/**
 * Get migration status
 */
export async function getMigrationStatus(migrations: Migration[]): Promise<{
  applied: MigrationMeta[];
  pending: Migration[];
}> {
  const applied = await getAppliedMigrations();
  const appliedVersions = new Set(applied.map((m) => m.version));
  
  const pending = migrations.filter((m) => !appliedVersions.has(m.version));
  
  return {
    applied,
    pending: sortMigrations(pending),
  };
}
