export const PROJECT_CONFIG_SCHEMA_VERSION = 1;

export interface ProjectConfig {
  schemaVersion: number;
  nextellarVersion: string;
  template: string;
  createdAt: string;
  [key: string]: unknown;
}

export function validateProjectConfig(value: unknown): ProjectConfig {
  if (!value || typeof value !== "object")
    throw new Error("Invalid .nextellar/config.json: expected an object");
  const config = value as Record<string, unknown>;
  if (config.schemaVersion !== PROJECT_CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Invalid .nextellar/config.json: schemaVersion must be ${PROJECT_CONFIG_SCHEMA_VERSION}`,
    );
  }
  for (const field of ["nextellarVersion", "template", "createdAt"]) {
    if (typeof config[field] !== "string" || !config[field]) {
      throw new Error(`Invalid .nextellar/config.json: ${field} is required`);
    }
  }
  return config as ProjectConfig;
}

/**
 * Legacy field names that older or hand-written configs used. Each alias is
 * only read when the current field is missing, and is never deleted, so a
 * migration is lossless.
 */
const LEGACY_ALIASES: Record<
  "nextellarVersion" | "template" | "createdAt",
  string[]
> = {
  nextellarVersion: ["version", "cliVersion"],
  template: ["templateName", "templateId"],
  createdAt: ["created", "created_at", "createdOn"],
};

export interface ConfigMigrationOptions {
  /** Used when no creation time can be recovered (e.g. the config file's mtime). */
  fallbackCreatedAt?: string;
}

export interface ConfigMigrationResult {
  config: ProjectConfig;
  /** Schema version the input was in; 0 means the pre-#906 unversioned shape. */
  fromVersion: number;
  /** True when the returned config differs from the input. */
  migrated: boolean;
  /** Human-readable list of what changed, for upgrade output. */
  changes: string[];
}

function toIsoDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Seconds vs milliseconds since epoch.
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

/**
 * Migrate any known `.nextellar/config.json` shape to the current schema
 * (issue #907).
 *
 * v0 (unversioned, every project scaffolded before `schemaVersion` existed)
 * and incomplete v1 files (e.g. hand-written, or a legacy file that
 * `nextellar init` stamped with `schemaVersion: 1` without the other fields):
 *   - add `schemaVersion`
 *   - fill `nextellarVersion` / `template` / `createdAt` from legacy aliases,
 *     or fall back to `"unknown"` / `"default"` / `fallbackCreatedAt`
 *   - convert an epoch-number `createdAt` to ISO 8601 (valid date strings are
 *     kept exactly as written, so current files are never churned)
 *   - turn a comma-separated `wallets` string into an array
 *
 * Unknown keys are preserved untouched. The function is pure and idempotent:
 * migrating an already-valid current config returns it unchanged
 * (`migrated: false`).
 *
 * @throws when the input is not an object, has a malformed schemaVersion, or
 *   comes from a newer CLI (a schemaVersion higher than this CLI understands)
 *   — that must never be downgraded silently.
 */
export function migrateProjectConfig(
  raw: unknown,
  opts: ConfigMigrationOptions = {},
): ConfigMigrationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid .nextellar/config.json: expected an object");
  }
  const input = raw as Record<string, unknown>;
  const declared = input.schemaVersion;

  if (
    declared !== undefined &&
    (typeof declared !== "number" ||
      !Number.isInteger(declared) ||
      declared < 0)
  ) {
    throw new Error(
      "Invalid .nextellar/config.json: schemaVersion must be a non-negative integer",
    );
  }
  const fromVersion = (declared as number | undefined) ?? 0;
  if (fromVersion > PROJECT_CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `.nextellar/config.json uses schemaVersion ${fromVersion}, but this CLI only understands up to ${PROJECT_CONFIG_SCHEMA_VERSION}. Update nextellar before running this command.`,
    );
  }

  const config: Record<string, unknown> = { ...input };
  const changes: string[] = [];

  for (const field of ["nextellarVersion", "template"] as const) {
    if (typeof config[field] === "string" && config[field]) continue;
    const alias = LEGACY_ALIASES[field].find(
      (key) => typeof input[key] === "string" && input[key],
    );
    if (alias) {
      config[field] = input[alias];
      changes.push(`${field}: copied from legacy "${alias}"`);
    } else {
      config[field] = field === "template" ? "default" : "unknown";
      changes.push(`${field}: missing, set to "${config[field]}"`);
    }
  }

  const keepAsWritten =
    typeof config.createdAt === "string" &&
    toIsoDate(config.createdAt) !== null;
  if (!keepAsWritten) {
    const createdSource =
      config.createdAt !== undefined
        ? "createdAt"
        : LEGACY_ALIASES.createdAt.find((key) => input[key] !== undefined);
    const createdAt = createdSource ? toIsoDate(input[createdSource]) : null;
    if (createdAt) {
      config.createdAt = createdAt;
      changes.push(
        createdSource === "createdAt"
          ? "createdAt: normalised to ISO 8601"
          : `createdAt: copied from legacy "${createdSource}"`,
      );
    } else {
      config.createdAt = opts.fallbackCreatedAt ?? new Date().toISOString();
      changes.push(
        "createdAt: unknown, set to the config file's last-modified time",
      );
    }
  }

  if (typeof config.wallets === "string") {
    config.wallets = config.wallets
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);
    changes.push("wallets: converted comma-separated string to a list");
  }

  if (fromVersion !== PROJECT_CONFIG_SCHEMA_VERSION) {
    config.schemaVersion = PROJECT_CONFIG_SCHEMA_VERSION;
    changes.unshift(
      `schemaVersion: ${fromVersion} -> ${PROJECT_CONFIG_SCHEMA_VERSION}`,
    );
  }

  return {
    config: validateProjectConfig(config),
    fromVersion,
    migrated: changes.length > 0,
    changes,
  };
}
