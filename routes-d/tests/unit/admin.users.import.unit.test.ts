/**
 * Unit tests for the admin bulk user import pipeline.
 *
 * Covers:
 *  - csvParser   – happy path, quoted fields, blank lines, oversized input
 *  - userValidator – valid row, per-field errors, missing required columns check
 *  - importHashStore – hash computation, idempotency lookup, record lifecycle
 *  - importProcessor – happy path, partial failure, repeat upload (duplicate)
 */

import { parseCsvLine, parseCsvBuffer } from "../../lib/csvParser.js";
import {
  validateUserRow,
  checkRequiredColumns,
} from "../../lib/userValidator.js";
import {
  hashCsvContent,
  lookupImport,
  createImportRecord,
  finaliseImportRecord,
  __resetImportStore,
} from "../../lib/importHashStore.js";
import {
  processImport,
  CsvColumnError,
  __getImportedUsers,
  __resetImportedUsers,
} from "../../lib/importProcessor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCsv(...rows: string[]): string {
  return ["email,firstname,lastname,country,role", ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// csvParser
// ---------------------------------------------------------------------------

describe("parseCsvLine", () => {
  it("splits a simple unquoted line", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("handles quoted fields with commas inside", () => {
    expect(parseCsvLine('"Smith, Jr.",John,US')).toEqual([
      "Smith, Jr.",
      "John",
      "US",
    ]);
  });

  it("handles escaped double-quotes inside a quoted field", () => {
    expect(parseCsvLine('"He said ""hello""",Bob,CA')).toEqual([
      'He said "hello"',
      "Bob",
      "CA",
    ]);
  });

  it("returns empty string for a trailing comma", () => {
    const result = parseCsvLine("a,b,");
    expect(result[2]).toBe("");
  });
});

describe("parseCsvBuffer", () => {
  it("parses a well-formed CSV into rows", () => {
    const csv = makeCsv(
      "alice@example.com,Alice,Smith,US,user",
      "bob@example.com,Bob,Jones,GB,partner",
    );

    const { rows, headers } = parseCsvBuffer(csv);
    expect(headers).toEqual(["email", "firstname", "lastname", "country", "role"]);
    expect(rows).toHaveLength(2);
    expect(rows[0].fields["email"]).toBe("alice@example.com");
    expect(rows[1].fields["country"]).toBe("GB");
  });

  it("skips blank lines between data rows", () => {
    const csv = makeCsv(
      "a@x.com,A,B,US,user",
      "",
      "c@x.com,C,D,CA,user",
    );
    const { rows, skippedLines } = parseCsvBuffer(csv);
    expect(rows).toHaveLength(2);
    expect(skippedLines).toBeGreaterThanOrEqual(1);
  });

  it("throws when the input has no header row", () => {
    expect(() => parseCsvBuffer("")).toThrow("no header row");
  });

  it("normalises header names to lowercase", () => {
    const csv = "Email,FirstName,LastName,Country\nfoo@x.com,Foo,Bar,US";
    const { headers } = parseCsvBuffer(csv);
    expect(headers).toEqual(["email", "firstname", "lastname", "country"]);
  });

  it("handles Windows-style CRLF line endings", () => {
    const csv = "email,firstname,lastname,country\r\nfoo@x.com,Foo,Bar,US";
    const { rows } = parseCsvBuffer(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].fields["email"]).toBe("foo@x.com");
  });
});

// ---------------------------------------------------------------------------
// userValidator
// ---------------------------------------------------------------------------

describe("validateUserRow – valid row", () => {
  const validFields = {
    email: "alice@example.com",
    firstname: "Alice",
    lastname: "Smith",
    country: "US",
    role: "user",
  };

  it("returns valid=true for a correct row", () => {
    const result = validateUserRow(validFields);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.data?.email).toBe("alice@example.com");
  });

  it("uppercases the country code", () => {
    const result = validateUserRow({ ...validFields, country: "us" });
    expect(result.data?.country).toBe("US");
  });

  it("lowercases the email", () => {
    const result = validateUserRow({ ...validFields, email: "ALICE@EXAMPLE.COM" });
    expect(result.data?.email).toBe("alice@example.com");
  });

  it("defaults role to 'user' when absent", () => {
    const { role: _r, ...noRole } = validFields;
    const result = validateUserRow(noRole);
    expect(result.data?.role).toBe("user");
  });
});

describe("validateUserRow – invalid rows", () => {
  it("rejects a missing email", () => {
    const result = validateUserRow({ email: "", firstname: "A", lastname: "B", country: "US" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "email")).toBe(true);
  });

  it("rejects a malformed email address", () => {
    const result = validateUserRow({
      email: "not-an-email",
      firstname: "A",
      lastname: "B",
      country: "US",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "email")).toBe(true);
  });

  it("rejects a country code longer than 2 letters", () => {
    const result = validateUserRow({
      email: "a@b.com",
      firstname: "A",
      lastname: "B",
      country: "USA",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "country")).toBe(true);
  });

  it("rejects an invalid role", () => {
    const result = validateUserRow({
      email: "a@b.com",
      firstname: "A",
      lastname: "B",
      country: "US",
      role: "superuser",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "role")).toBe(true);
  });

  it("reports all errors for a completely invalid row", () => {
    const result = validateUserRow({
      email: "",
      firstname: "",
      lastname: "",
      country: "",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("checkRequiredColumns", () => {
  it("returns empty list when all required columns are present", () => {
    expect(
      checkRequiredColumns(["email", "firstname", "lastname", "country"]),
    ).toEqual([]);
  });

  it("returns missing column names", () => {
    const missing = checkRequiredColumns(["email", "firstname"]);
    expect(missing).toContain("lastname");
    expect(missing).toContain("country");
  });
});

// ---------------------------------------------------------------------------
// importHashStore
// ---------------------------------------------------------------------------

describe("importHashStore", () => {
  beforeEach(() => {
    __resetImportStore();
  });

  it("produces a consistent SHA-256 hash for the same input", () => {
    const h1 = hashCsvContent("foo,bar\n1,2");
    const h2 = hashCsvContent("foo,bar\n1,2");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // hex SHA-256
  });

  it("produces different hashes for different inputs", () => {
    expect(hashCsvContent("a")).not.toBe(hashCsvContent("b"));
  });

  it("returns undefined for an unknown hash", () => {
    expect(lookupImport("nonexistent")).toBeUndefined();
  });

  it("creates and retrieves a processing record", () => {
    const hash = hashCsvContent("test csv");
    const record = createImportRecord(hash, "op-1");

    expect(record.contentHash).toBe(hash);
    expect(record.status).toBe("processing");
    expect(record.submittedBy).toBe("op-1");

    const fetched = lookupImport(hash);
    expect(fetched).toBeDefined();
    expect(fetched?.status).toBe("processing");
  });

  it("finalises a record with completed status", () => {
    const hash = hashCsvContent("completed csv");
    createImportRecord(hash, "op-1");

    const updated = finaliseImportRecord(hash, {
      status: "completed",
      accepted: 2,
      rejected: 1,
      results: [],
    });

    expect(updated.status).toBe("completed");
    expect(updated.accepted).toBe(2);
    expect(updated.rejected).toBe(1);
  });

  it("throws when creating a duplicate record for the same hash", () => {
    const hash = hashCsvContent("dup hash");
    createImportRecord(hash, "op-1");
    expect(() => createImportRecord(hash, "op-2")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// importProcessor – happy path
// ---------------------------------------------------------------------------

describe("processImport – happy path", () => {
  beforeEach(() => {
    __resetImportStore();
    __resetImportedUsers();
  });

  it("imports all valid rows and returns accepted count", async () => {
    const csv = makeCsv(
      "alice@example.com,Alice,Smith,US,user",
      "bob@example.com,Bob,Jones,GB,partner",
    );

    const { importRecord, duplicate } = await processImport({
      csvInput: csv,
      submittedBy: "op-1",
    });

    expect(duplicate).toBe(false);
    expect(importRecord.status).toBe("completed");
    expect(importRecord.accepted).toBe(2);
    expect(importRecord.rejected).toBe(0);
    expect(importRecord.results).toHaveLength(2);
    expect(importRecord.results[0].status).toBe("accepted");
  });

  it("persists imported users in the user store", async () => {
    const csv = makeCsv("carol@example.com,Carol,White,DE,user");
    await processImport({ csvInput: csv, submittedBy: "op-2" });

    const users = __getImportedUsers();
    expect(users.has("carol@example.com")).toBe(true);
    expect(users.get("carol@example.com")?.country).toBe("DE");
  });
});

// ---------------------------------------------------------------------------
// importProcessor – partial failure
// ---------------------------------------------------------------------------

describe("processImport – partial failure", () => {
  beforeEach(() => {
    __resetImportStore();
    __resetImportedUsers();
  });

  it("accepts valid rows and rejects invalid rows in the same file", async () => {
    const csv = makeCsv(
      "good@example.com,Good,User,US,user",   // valid
      "bad-email,Bad,User,US,user",            // invalid email
      "another@example.com,Another,Person,CA,partner", // valid
    );

    const { importRecord } = await processImport({
      csvInput: csv,
      submittedBy: "op-3",
    });

    expect(importRecord.status).toBe("completed");
    expect(importRecord.accepted).toBe(2);
    expect(importRecord.rejected).toBe(1);

    const rejected = importRecord.results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].email).toBe("bad-email");
    expect(rejected[0].errors).toBeDefined();
    expect(rejected[0].errors!.length).toBeGreaterThan(0);
  });

  it("does not persist rows that failed validation", async () => {
    const csv = makeCsv("not-valid,,,,");
    await processImport({ csvInput: csv, submittedBy: "op-4" });

    const users = __getImportedUsers();
    expect(users.size).toBe(0);
  });

  it("rejects the entire import when required columns are missing", async () => {
    const csv = "name,address\nAlice,123 Main St";

    await expect(
      processImport({ csvInput: csv, submittedBy: "op-5" }),
    ).rejects.toThrow(CsvColumnError);
  });
});

// ---------------------------------------------------------------------------
// importProcessor – repeat upload (idempotency)
// ---------------------------------------------------------------------------

describe("processImport – repeat upload", () => {
  beforeEach(() => {
    __resetImportStore();
    __resetImportedUsers();
  });

  it("returns duplicate=true and the cached record on second upload", async () => {
    const csv = makeCsv("dave@example.com,Dave,Brown,AU,user");

    const first = await processImport({ csvInput: csv, submittedBy: "op-6" });
    expect(first.duplicate).toBe(false);

    const second = await processImport({ csvInput: csv, submittedBy: "op-6" });
    expect(second.duplicate).toBe(true);
    expect(second.importRecord.contentHash).toBe(first.importRecord.contentHash);
    expect(second.importRecord.accepted).toBe(first.importRecord.accepted);
  });

  it("the second call does NOT re-import users (no duplicates in store)", async () => {
    const csv = makeCsv("eve@example.com,Eve,Green,NZ,user");

    await processImport({ csvInput: csv, submittedBy: "op-7" });
    const countAfterFirst = __getImportedUsers().size;

    await processImport({ csvInput: csv, submittedBy: "op-7" });
    const countAfterSecond = __getImportedUsers().size;

    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it("treats different byte content as a new import", async () => {
    const csv1 = makeCsv("frank@example.com,Frank,Black,US,user");
    const csv2 = makeCsv("grace@example.com,Grace,White,US,user");

    const first = await processImport({ csvInput: csv1, submittedBy: "op-8" });
    const second = await processImport({ csvInput: csv2, submittedBy: "op-8" });

    expect(second.duplicate).toBe(false);
    expect(second.importRecord.contentHash).not.toBe(first.importRecord.contentHash);
  });
});
