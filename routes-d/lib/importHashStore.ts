/**
 * importHashStore.ts
 *
 * Idempotency layer for bulk user imports.
 *
 * Strategy:
 *  - SHA-256 the raw CSV bytes (before parsing) to produce a stable content hash.
 *  - Store the hash → ImportRecord in an in-memory map with a configurable TTL.
 *  - A second upload of the exact same bytes returns the cached result immediately
 *    without re-processing, satisfying the idempotency requirement.
 *
 * In production this store should be backed by Redis or a DB so it survives
 * restarts; the interface is kept simple enough to swap out.
 */

import crypto from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImportStatus = "processing" | "completed" | "failed";

export interface ImportRecord {
  /** SHA-256 hex digest of the raw CSV bytes */
  contentHash: string;
  /** When the import was first submitted */
  createdAt: string;
  /** Last status update */
  updatedAt: string;
  status: ImportStatus;
  /** Operator who submitted this import */
  submittedBy: string;
  /** Number of rows that were accepted */
  accepted: number;
  /** Number of rows that failed validation */
  rejected: number;
  /** Per-row outcomes – only populated once status === "completed" */
  results: RowOutcome[];
}

export interface RowOutcome {
  row: number;
  email: string;
  status: "accepted" | "rejected";
  errors?: string[];
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** TTL in milliseconds – defaults to 24 hours */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

interface StoreEntry {
  record: ImportRecord;
  expiresAt: number;
}

const store = new Map<string, StoreEntry>();

// Periodic sweep of expired entries
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let sweepTimer: ReturnType<typeof setInterval> | null = null;

function startSweep(): void {
  if (sweepTimer !== null) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.expiresAt < now) store.delete(key);
    }
  }, SWEEP_INTERVAL_MS);

  // Don't block process exit
  if (sweepTimer.unref) sweepTimer.unref();
}

startSweep();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 content hash of the raw CSV input.
 */
export function hashCsvContent(input: string | Buffer): string {
  const data = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Check whether a hash has already been imported.
 * Returns the stored record or `undefined` if not found / expired.
 */
export function lookupImport(contentHash: string): ImportRecord | undefined {
  const entry = store.get(contentHash);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    store.delete(contentHash);
    return undefined;
  }
  return entry.record;
}

/**
 * Create a new import record in "processing" state.
 * @throws if the hash already exists (call lookupImport first).
 */
export function createImportRecord(
  contentHash: string,
  submittedBy: string,
  ttlMs = DEFAULT_TTL_MS,
): ImportRecord {
  if (store.has(contentHash)) {
    throw new Error(
      `Import record for hash ${contentHash} already exists; use lookupImport`,
    );
  }

  const now = new Date().toISOString();
  const record: ImportRecord = {
    contentHash,
    createdAt: now,
    updatedAt: now,
    status: "processing",
    submittedBy,
    accepted: 0,
    rejected: 0,
    results: [],
  };

  store.set(contentHash, { record, expiresAt: Date.now() + ttlMs });
  return record;
}

/**
 * Update an existing import record with final results.
 * The record is mutated in place (it is stored by reference).
 */
export function finaliseImportRecord(
  contentHash: string,
  update: Pick<ImportRecord, "status" | "accepted" | "rejected" | "results">,
): ImportRecord {
  const entry = store.get(contentHash);
  if (!entry) throw new Error(`Import record not found: ${contentHash}`);

  Object.assign(entry.record, {
    ...update,
    updatedAt: new Date().toISOString(),
  });

  return entry.record;
}

// ---------------------------------------------------------------------------
// Test helpers (exported only for use in test files)
// ---------------------------------------------------------------------------

export function __resetImportStore(): void {
  store.clear();
}

export function __getImportStore(): Map<string, StoreEntry> {
  return store;
}

export function __stopSweep(): void {
  if (sweepTimer !== null) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
