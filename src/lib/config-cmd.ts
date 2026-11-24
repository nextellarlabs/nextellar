import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import { validateProjectConfig } from "./project-config.js";

// `nextellar config get|set|list` (#1484): read and write
// `.nextellar/config.json` with dotted key paths, validated against the shape in
// docs/nextellar-config.schema.json. The pure helpers (parseKeyPath,
// getConfigValue, setConfigValue) have no I/O so they can be tested directly;
// runConfig does the file work.

export type ConfigAction = "get" | "set" | "list";

export interface ConfigCommandOptions {
  /** Directory containing `.nextellar/`; defaults to process.cwd(). */
  cwd?: string;
  action: ConfigAction;
  key?: string;
  value?: string;
  /** Print machine-readable JSON instead of text. */
  json?: boolean;
}

export interface ConfigCommandResult {
  action: ConfigAction;
  key?: string;
  value?: unknown;
  /** The value before a `set`; undefined when the key did not exist. */
  previous?: unknown;
  config: Record<string, unknown>;
}

/** Keys the CLI manages itself; `set` refuses to change them. */
export const READ_ONLY_KEYS = ["schemaVersion", "nextellarVersion"] as const;

/** Top-level keys described by docs/nextellar-config.schema.json. */
export const KNOWN_KEYS = [
  "schemaVersion",
  "nextellarVersion",
  "template",
  "createdAt",
  "horizonUrl",
  "sorobanUrl",
  "wallets",
] as const;

const UNSAFE_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/** Splits `a.b.c` into segments, rejecting empty or prototype-polluting ones. */
export function parseKeyPath(key: string | undefined): string[] {
  if (!key || !key.trim()) {
    throw new Error("A config key is required, for example: horizonUrl");
  }
  const segments = key.trim().split(".");
  for (const segment of segments) {
    if (!segment) {
      throw new Error(`Invalid config key "${key}": empty path segment`);
    }
    if (UNSAFE_SEGMENTS.has(segment)) {
      throw new Error(`Invalid config key "${key}": "${segment}" is not allowed`);
    }
  }
  return segments;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Looks up a dotted path. `found` is false when any segment is missing. */
export function getConfigValue(
  config: Record<string, unknown>,
  key: string,
): { found: boolean; value?: unknown } {
  let current: unknown = config;
  for (const segment of parseKeyPath(key)) {
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

/** Parses a CLI value: JSON when it parses (true, 3, [..], "x"), else the raw string. */
export function parseConfigValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates and normalizes a value for a schema-known top-level key. Returns the
 * value to store, or throws a message naming the key and what was expected.
 */
export function validateKnownValue(key: string, value: unknown): unknown {
  switch (key) {
    case "template":
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Invalid value for "template": expected a non-empty string`);
      }
      return value;
    case "createdAt":
      if (
        typeof value !== "string" ||
        Number.isNaN(new Date(value).getTime())
      ) {
        throw new Error(
          `Invalid value for "createdAt": expected an ISO 8601 date-time string`,
        );
      }
      return value;
    case "horizonUrl":
    case "sorobanUrl":
      if (!isHttpUrl(value)) {
        throw new Error(
          `Invalid value for "${key}": expected an http(s) URL, got ${JSON.stringify(value)}`,
        );
      }
      return value;
    case "wallets": {
      // A comma-separated string is accepted as a convenience on the CLI.
      const list =
        typeof value === "string"
          ? value
              .split(",")
              .map((w) => w.trim())
              .filter(Boolean)
          : value;
      if (
        !Array.isArray(list) ||
        !list.every((w) => typeof w === "string" && w)
      ) {
        throw new Error(
          `Invalid value for "wallets": expected a list of wallet names, for example freighter,xbull`,
        );
      }
      return list;
    }
    default:
      return value;
  }
}

/**
 * Returns a copy of `config` with `key` set to the parsed `rawValue`.
 *
 * - `schemaVersion` and `nextellarVersion` are managed by the CLI and refused.
 * - Schema-known keys are validated by type.
 * - Other keys can be edited only if they already exist in the file; a new key
 *   that is not in the schema is an error, so a typo does not silently add one.
 * - Nested paths are allowed only below an existing custom object.
 */
export function setConfigValue(
  config: Record<string, unknown>,
  key: string,
  rawValue: string,
): { config: Record<string, unknown>; value: unknown; previous?: unknown } {
  const segments = parseKeyPath(key);
  const top = segments[0];

  if ((READ_ONLY_KEYS as readonly string[]).includes(top)) {
    throw new Error(
      `"${top}" is managed by nextellar and cannot be set; run \`nextellar upgrade\` to change it`,
    );
  }

  const known = (KNOWN_KEYS as readonly string[]).includes(top);
  if (!known && !Object.prototype.hasOwnProperty.call(config, top)) {
    throw new Error(
      `Unknown config key "${top}". Known keys: ${KNOWN_KEYS.join(", ")}`,
    );
  }
  if (known && segments.length > 1) {
    throw new Error(
      `"${top}" has no nested keys; set "${top}" as a whole instead`,
    );
  }

  const parsed = parseConfigValue(rawValue);
  const value = known ? validateKnownValue(top, parsed) : parsed;

  const next: Record<string, unknown> = JSON.parse(JSON.stringify(config));
  let cursor: Record<string, unknown> = next;
  for (const segment of segments.slice(0, -1)) {
    const child = cursor[segment];
    if (!isPlainObject(child)) {
      throw new Error(
        `Cannot set "${key}": "${segment}" is not an existing object in the config`,
      );
    }
    cursor = child;
  }
  const last = segments[segments.length - 1];
  const previous = cursor[last];
  cursor[last] = value;

  return { config: next, value, previous };
}

async function readConfig(cwd: string): Promise<{
  file: string;
  config: Record<string, unknown>;
}> {
  const file = path.join(cwd, ".nextellar", "config.json");
  if (!(await fs.pathExists(file))) {
    throw new Error(
      "No .nextellar/config.json found. Run this from a Nextellar project (or run `nextellar init`).",
    );
  }
  let raw: unknown;
  try {
    raw = await fs.readJson(file);
  } catch (err: any) {
    throw new Error(
      `Could not read .nextellar/config.json: ${err?.message || err}`,
    );
  }
  if (!isPlainObject(raw)) {
    throw new Error("Invalid .nextellar/config.json: expected an object");
  }
  return { file, config: raw };
}

/** Writes through a temp file and rename so a crash never leaves half a config. */
async function writeConfigAtomic(
  file: string,
  config: Record<string, unknown>,
): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await fs.move(tmp, file, { overwrite: true });
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Runs `nextellar config <action>` and prints its result. */
export async function runConfig(
  options: ConfigCommandOptions,
): Promise<ConfigCommandResult> {
  const cwd = options.cwd || process.cwd();
  const { file, config } = await readConfig(cwd);

  if (options.action === "list") {
    console.log(
      options.json
        ? JSON.stringify(config, null, 2)
        : Object.entries(config)
            .map(([k, v]) => `${k}: ${formatValue(v)}`)
            .join("\n"),
    );
    return { action: "list", config };
  }

  if (options.action === "get") {
    const found = getConfigValue(config, options.key as string);
    if (!found.found) {
      throw new Error(`Config key "${options.key}" is not set`);
    }
    console.log(
      options.json
        ? JSON.stringify({ key: options.key, value: found.value })
        : formatValue(found.value),
    );
    return { action: "get", key: options.key, value: found.value, config };
  }

  if (options.action === "set") {
    if (options.value === undefined) {
      throw new Error(`A value is required: nextellar config set ${options.key ?? "<key>"} <value>`);
    }
    const result = setConfigValue(config, options.key as string, options.value);
    // The result must still be a valid project config before it is written.
    validateProjectConfig(result.config);
    await writeConfigAtomic(file, result.config);
    console.log(
      options.json
        ? JSON.stringify({
            key: options.key,
            value: result.value,
            previous: result.previous,
          })
        : pc.green(`✔️  ${options.key} = ${formatValue(result.value)}`),
    );
    return {
      action: "set",
      key: options.key,
      value: result.value,
      previous: result.previous,
      config: result.config,
    };
  }

  throw new Error(
    `Unknown config action "${options.action}". Use get, set or list.`,
  );
}
