/**
 * Support for `nextellar upgrade --interactive` (#1487).
 *
 * The interactive flow lets a user apply/skip/quit each drifted template file
 * one at a time. Two pieces of state are involved:
 *
 *  - `.nextellar/upgrade-state.json` records the SHA-256 of the *incoming*
 *    template content for every file the user chose to skip. On a later run
 *    the hash is recomputed: a match means the template has not changed since
 *    the user last declined it, so it is auto-skipped without prompting again;
 *    a mismatch (or no record) means it is worth asking about again.
 *
 * Everything here is deliberately free of console output and PTY assumptions
 * so tests can inject a deterministic prompt handler instead of driving a
 * real terminal.
 */

import { createHash } from "node:crypto";
import path from "path";
import fs from "fs-extra";
import pc from "picocolors";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

/** Schema version written to `.nextellar/upgrade-state.json`. */
export const UPGRADE_STATE_SCHEMA_VERSION = 1;

/** What the user chose to do with one candidate file. */
export type UpgradeDecision = "apply" | "skip" | "quit";

export interface UpgradePromptContext {
  /** POSIX-normalized path relative to the project's `src/` directory. */
  file: string;
  /** Whether the template adds the file or modifies an existing one. */
  status: "added" | "updated";
}

/**
 * Injectable prompt callback. Returning a value (or a promise of one) lets
 * tests drive the interactive flow deterministically, and lets embedders
 * provide their own UI without a TTY.
 */
export type UpgradePromptHandler = (
  ctx: UpgradePromptContext,
) => Promise<UpgradeDecision> | UpgradeDecision;

export interface UpgradeState {
  schemaVersion: number;
  updatedAt: string;
  /** POSIX-relative file path -> SHA-256 hex digest of the skipped template. */
  skipped: Record<string, string>;
}

/** Normalizes a native path to the POSIX form persisted in upgrade-state.json. */
export function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/** SHA-256 hex digest of a buffer (or string, encoded as UTF-8). */
export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Heuristic binary check: a NUL byte in the first 8 KB is treated as binary.
 * Template candidates are normally text, but this keeps the preview readable
 * if a binary asset ever lands under src/hooks or src/lib.
 */
export function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000);
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true;
  }
  return false;
}

/** Human-readable byte size, e.g. `1.2 KB`, for binary diff summaries. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/** Absolute path to a project's interactive-upgrade skip state. */
export function upgradeStatePath(projectRoot: string): string {
  return path.join(projectRoot, ".nextellar", "upgrade-state.json");
}

export interface UpgradeStateLoadResult {
  state: UpgradeState;
  /** True when the file existed but could not be parsed/validated. */
  corrupted: boolean;
}

function emptyState(): UpgradeState {
  return {
    schemaVersion: UPGRADE_STATE_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
    skipped: {},
  };
}

/** Validates/normalizes a parsed state object; returns null when unusable. */
function normalizeState(value: unknown): UpgradeState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const rawSkipped = record.skipped;
  if (
    !rawSkipped ||
    typeof rawSkipped !== "object" ||
    Array.isArray(rawSkipped)
  ) {
    return null;
  }
  const skipped: Record<string, string> = {};
  for (const [key, hash] of Object.entries(rawSkipped)) {
    if (typeof hash === "string") skipped[key] = hash;
  }
  return {
    schemaVersion:
      typeof record.schemaVersion === "number"
        ? record.schemaVersion
        : UPGRADE_STATE_SCHEMA_VERSION,
    updatedAt:
      typeof record.updatedAt === "string"
        ? record.updatedAt
        : new Date(0).toISOString(),
    skipped,
  };
}

/**
 * Loads `.nextellar/upgrade-state.json`, recovering gracefully from a missing
 * or malformed file. A corrupt file never throws: the caller gets an empty
 * state plus a `corrupted` flag so it can warn and start fresh.
 */
export async function loadUpgradeState(
  projectRoot: string,
): Promise<UpgradeStateLoadResult> {
  const file = upgradeStatePath(projectRoot);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { state: emptyState(), corrupted: false };
    }
    return { state: emptyState(), corrupted: true };
  }

  try {
    const state = normalizeState(JSON.parse(raw));
    if (!state) return { state: emptyState(), corrupted: true };
    return { state, corrupted: false };
  } catch {
    return { state: emptyState(), corrupted: true };
  }
}

/**
 * Persists the skip state. `updatedAt` is stamped here (not by the caller) so
 * every incremental flush records when the last decision was made.
 */
export async function saveUpgradeState(
  projectRoot: string,
  state: UpgradeState,
): Promise<void> {
  const file = upgradeStatePath(projectRoot);
  await fs.ensureDir(path.dirname(file));
  await fs.writeJson(
    file,
    { ...state, updatedAt: new Date().toISOString() },
    { spaces: 2 },
  );
}

export interface ReadlineUpgradePrompt {
  handler: UpgradePromptHandler;
  close: () => void;
}

/**
 * Default prompt adapter backed by readline. Kept separate from the decision
 * loop so tests never need a PTY; callers that inject their own handler can
 * ignore this entirely.
 */
export function createReadlineUpgradePrompt(
  opts: {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
  } = {},
): ReadlineUpgradePrompt {
  const rl = readline.createInterface({
    input: opts.input ?? input,
    output: opts.output ?? output,
  });

  const handler: UpgradePromptHandler = async () => {
    for (;;) {
      const answer = (
        (await rl.question(
          pc.yellow("Apply this change? [a]pply / [s]kip / [q]uit: "),
        )) || ""
      )
        .trim()
        .toLowerCase();
      if (answer === "a" || answer === "apply") return "apply";
      if (answer === "s" || answer === "skip") return "skip";
      if (answer === "q" || answer === "quit") return "quit";
      console.log(pc.dim("Please answer a, s, or q."));
    }
  };

  return { handler, close: () => rl.close() };
}
