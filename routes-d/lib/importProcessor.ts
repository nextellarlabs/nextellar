/**
 * importProcessor.ts
 *
 * Orchestrates the bulk user import pipeline:
 *  1. Parse CSV bytes
 *  2. Check required columns
 *  3. Validate each row
 *  4. Persist accepted rows (in-memory store used here; swap for DB in prod)
 *  5. Finalise the import record with per-row outcomes
 */

import { parseCsvBuffer } from "./csvParser.js";
import {
  checkRequiredColumns,
  validateUserRow,
  type UserImportRow,
} from "./userValidator.js";
import {
  hashCsvContent,
  lookupImport,
  createImportRecord,
  finaliseImportRecord,
  type ImportRecord,
  type RowOutcome,
} from "./importHashStore.js";

// ---------------------------------------------------------------------------
// In-memory user store (replace with DB adapter in production)
// ---------------------------------------------------------------------------

export type StoredUser = UserImportRow & {
  importedAt: string;
  importHash: string;
};

const importedUsers = new Map<string, StoredUser>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ProcessImportOptions {
  /** Raw CSV bytes or string */
  csvInput: string | Buffer;
  /** Operator who submitted the import */
  submittedBy: string;
}

export interface ProcessImportResult {
  importRecord: ImportRecord;
  /** true when this was a duplicate upload that returned the cached result */
  duplicate: boolean;
}

/**
 * Process a bulk user import CSV.
 *
 * Idempotent: calling this function twice with identical CSV bytes returns
 * the cached ImportRecord on the second call without re-processing.
 */
export async function processImport(
  options: ProcessImportOptions,
): Promise<ProcessImportResult> {
  const { csvInput, submittedBy } = options;

  // 1. Hash the raw input for idempotency lookup
  const contentHash = hashCsvContent(csvInput);

  const existing = lookupImport(contentHash);
  if (existing) {
    return { importRecord: existing, duplicate: true };
  }

  // 2. Create a processing record (marks it as "in flight")
  const record = createImportRecord(contentHash, submittedBy);

  try {
    // 3. Parse CSV
    const { rows, headers } = parseCsvBuffer(csvInput);

    // 4. Check required columns
    const missingColumns = checkRequiredColumns(headers);
    if (missingColumns.length > 0) {
      finaliseImportRecord(contentHash, {
        status: "failed",
        accepted: 0,
        rejected: 0,
        results: [],
      });
      throw new CsvColumnError(
        `Missing required CSV columns: ${missingColumns.join(", ")}`,
        missingColumns,
      );
    }

    // 5. Validate each row and collect outcomes
    const outcomes: RowOutcome[] = [];
    let accepted = 0;
    let rejected = 0;

    for (const row of rows) {
      const result = validateUserRow(row.fields);

      if (result.valid && result.data) {
        const user = result.data;
        const stored: StoredUser = {
          ...user,
          importedAt: new Date().toISOString(),
          importHash: contentHash,
        };
        // Upsert by email (last row wins for duplicates within the same file)
        importedUsers.set(user.email.toLowerCase(), stored);

        outcomes.push({
          row: row.index,
          email: user.email,
          status: "accepted",
        });
        accepted++;
      } else {
        // Best-effort email extraction for the error report
        const rawEmail = (row.fields["email"] ?? "").trim();
        outcomes.push({
          row: row.index,
          email: rawEmail,
          status: "rejected",
          errors: result.errors.map((e) => `${e.field}: ${e.message}`),
        });
        rejected++;
      }
    }

    // 6. Finalise
    const finalRecord = finaliseImportRecord(contentHash, {
      status: "completed",
      accepted,
      rejected,
      results: outcomes,
    });

    return { importRecord: finalRecord, duplicate: false };
  } catch (err) {
    // Ensure the record is marked failed for non-CsvColumnError exceptions too
    if (!(err instanceof CsvColumnError)) {
      try {
        finaliseImportRecord(contentHash, {
          status: "failed",
          accepted: 0,
          rejected: 0,
          results: [],
        });
      } catch {
        // ignore – record may already be updated
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Custom error types
// ---------------------------------------------------------------------------

export class CsvColumnError extends Error {
  readonly missingColumns: string[];

  constructor(message: string, missingColumns: string[]) {
    super(message);
    this.name = "CsvColumnError";
    this.missingColumns = missingColumns;
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

export function __getImportedUsers(): Map<string, StoredUser> {
  return importedUsers;
}

export function __resetImportedUsers(): void {
  importedUsers.clear();
}
